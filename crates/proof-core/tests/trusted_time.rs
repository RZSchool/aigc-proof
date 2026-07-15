use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use cms::cert::CertificateChoices;
use cms::signed_data::{SignedData, SignerIdentifier};
use der::asn1::{Any, OctetString};
use der::{Decode, Encode};
use proof_core::{
    AddAssetOptions, InitWorkspaceOptions, KeyStoreError, SealOptions, SignerKeyStore,
    SignerService, VerificationLimits, add_asset, attach_timestamp_response,
    build_timestamp_request, current_timestamp, init_workspace, inspect_package, parse_tsa_profile,
    prepare_timestamp_request, seal_signed_workspace_with_timestamp, verify_package_with_profile,
};
use proof_schema::{AssetRole, TimeAssurance, VerificationStatus};
use tempfile::{TempDir, tempdir};
use uuid::Uuid;
use x509_cert::Certificate;
use x509_tsp::TimeStampResp;
use zeroize::Zeroizing;
use zip::ZipArchive;

#[derive(Default)]
struct MemoryStore(Mutex<Option<Zeroizing<Vec<u8>>>>);

impl SignerKeyStore for MemoryStore {
    fn load(&self) -> Result<Option<Zeroizing<Vec<u8>>>, KeyStoreError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .as_ref()
            .map(|value| Zeroizing::new(value.to_vec())))
    }

    fn store(&self, value: &[u8]) -> Result<(), KeyStoreError> {
        *self.0.lock().unwrap() = Some(Zeroizing::new(value.to_vec()));
        Ok(())
    }

    fn delete(&self) -> Result<(), KeyStoreError> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

struct TsaFixture {
    _root: TempDir,
    openssl: PathBuf,
    directory: PathBuf,
    root_der: Vec<u8>,
    tsa_der: Vec<u8>,
    alternate_der: Vec<u8>,
    invalid_eku_der: Vec<u8>,
    rsa_der: Vec<u8>,
    empty_crl_der: Vec<u8>,
    revoked_crl_der: Vec<u8>,
}

impl TsaFixture {
    fn create() -> Self {
        let root = tempdir().unwrap();
        let directory = root.path().join("tsa");
        fs::create_dir(&directory).unwrap();
        let openssl = openssl_path();
        run(
            &openssl,
            &directory,
            &[
                "req",
                "-x509",
                "-newkey",
                "ec",
                "-pkeyopt",
                "ec_paramgen_curve:P-256",
                "-nodes",
                "-keyout",
                "root.key",
                "-out",
                "root.pem",
                "-days",
                "3650",
                "-sha256",
                "-subj",
                "/CN=AIGC Proof Test Root",
                "-addext",
                "basicConstraints=critical,CA:TRUE",
                "-addext",
                "keyUsage=critical,keyCertSign,cRLSign",
            ],
        );
        run(
            &openssl,
            &directory,
            &[
                "genpkey",
                "-algorithm",
                "EC",
                "-pkeyopt",
                "ec_paramgen_curve:P-256",
                "-out",
                "tsa.key",
            ],
        );
        run(
            &openssl,
            &directory,
            &[
                "req",
                "-new",
                "-key",
                "tsa.key",
                "-out",
                "tsa.csr",
                "-subj",
                "/CN=AIGC Proof Test TSA",
            ],
        );
        fs::write(
            directory.join("tsa.ext"),
            "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n",
        )
        .unwrap();
        run(
            &openssl,
            &directory,
            &[
                "x509",
                "-req",
                "-in",
                "tsa.csr",
                "-CA",
                "root.pem",
                "-CAkey",
                "root.key",
                "-CAcreateserial",
                "-out",
                "tsa.pem",
                "-days",
                "365",
                "-sha256",
                "-extfile",
                "tsa.ext",
            ],
        );
        run(
            &openssl,
            &directory,
            &[
                "x509", "-in", "root.pem", "-outform", "DER", "-out", "root.der",
            ],
        );
        run(
            &openssl,
            &directory,
            &[
                "x509", "-in", "tsa.pem", "-outform", "DER", "-out", "tsa.der",
            ],
        );
        fs::write(directory.join("tsaserial"), "01\n").unwrap();
        let portable = directory.to_string_lossy().replace('\\', "/");
        fs::write(
            directory.join("tsa.conf"),
            format!(
                "dir={portable}\n[tsa]\ndefault_tsa=tsa_config1\n[tsa_config1]\nserial=$dir/tsaserial\ncrypto_device=builtin\nsigner_cert=$dir/tsa.pem\ncerts=$dir/root.pem\nsigner_key=$dir/tsa.key\nsigner_digest=sha256\ndefault_policy=1.2.3.4.1\nother_policies=1.2.3.4.2\ndigests=sha256\naccuracy=secs:1\nordering=no\ntsa_name=yes\ness_cert_id_chain=no\ness_cert_id_alg=sha256\n"
            ),
        )
        .unwrap();
        fs::write(directory.join("index.txt"), "").unwrap();
        fs::write(directory.join("caserial"), "1000\n").unwrap();
        fs::write(directory.join("crlnumber"), "1000\n").unwrap();
        fs::write(
            directory.join("ca.conf"),
            format!(
                "dir={portable}\n[ca]\ndefault_ca=CA_default\n[CA_default]\ndatabase=$dir/index.txt\nnew_certs_dir=$dir\ncertificate=$dir/root.pem\nprivate_key=$dir/root.key\nserial=$dir/caserial\ncrlnumber=$dir/crlnumber\ndefault_md=sha256\ndefault_crl_days=3650\npolicy=policy_any\n[policy_any]\ncommonName=supplied\n"
            ),
        )
        .unwrap();
        run(
            &openssl,
            &directory,
            &[
                "ca",
                "-config",
                "ca.conf",
                "-gencrl",
                "-out",
                "empty.crl.pem",
                "-batch",
            ],
        );
        run(
            &openssl,
            &directory,
            &[
                "crl",
                "-in",
                "empty.crl.pem",
                "-outform",
                "DER",
                "-out",
                "empty.crl.der",
            ],
        );
        let serial_output = command_output(
            &openssl,
            &directory,
            &["x509", "-in", "tsa.pem", "-noout", "-serial"],
        );
        let serial = serial_output.trim().strip_prefix("serial=").unwrap();
        let serial_argument = format!("0x{serial}");
        fs::write(
            directory.join("tsa-alternate.ext"),
            "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n",
        )
        .unwrap();
        issue_certificate_variant(
            &openssl,
            &directory,
            "tsa.csr",
            "tsa-alternate.pem",
            "tsa-alternate.der",
            "tsa-alternate.ext",
            &serial_argument,
        );
        fs::write(
            directory.join("tsa-invalid-eku.ext"),
            "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n",
        )
        .unwrap();
        issue_certificate_variant(
            &openssl,
            &directory,
            "tsa.csr",
            "tsa-invalid-eku.pem",
            "tsa-invalid-eku.der",
            "tsa-invalid-eku.ext",
            &serial_argument,
        );
        run(
            &openssl,
            &directory,
            &[
                "genpkey",
                "-algorithm",
                "RSA",
                "-pkeyopt",
                "rsa_keygen_bits:2048",
                "-out",
                "tsa-rsa.key",
            ],
        );
        run(
            &openssl,
            &directory,
            &[
                "req",
                "-new",
                "-key",
                "tsa-rsa.key",
                "-out",
                "tsa-rsa.csr",
                "-subj",
                "/CN=AIGC Proof Test TSA",
            ],
        );
        issue_certificate_variant(
            &openssl,
            &directory,
            "tsa-rsa.csr",
            "tsa-rsa.pem",
            "tsa-rsa.der",
            "tsa-alternate.ext",
            &serial_argument,
        );
        fs::write(
            directory.join("index.txt"),
            format!("V\t350101000000Z\t\t{serial}\tunknown\t/CN=AIGC Proof Test TSA\n"),
        )
        .unwrap();
        run(
            &openssl,
            &directory,
            &["ca", "-config", "ca.conf", "-revoke", "tsa.pem", "-batch"],
        );
        run(
            &openssl,
            &directory,
            &[
                "ca",
                "-config",
                "ca.conf",
                "-gencrl",
                "-out",
                "revoked.crl.pem",
                "-batch",
            ],
        );
        run(
            &openssl,
            &directory,
            &[
                "crl",
                "-in",
                "revoked.crl.pem",
                "-outform",
                "DER",
                "-out",
                "revoked.crl.der",
            ],
        );
        let root_der = fs::read(directory.join("root.der")).unwrap();
        let tsa_der = fs::read(directory.join("tsa.der")).unwrap();
        let alternate_der = fs::read(directory.join("tsa-alternate.der")).unwrap();
        let invalid_eku_der = fs::read(directory.join("tsa-invalid-eku.der")).unwrap();
        let rsa_der = fs::read(directory.join("tsa-rsa.der")).unwrap();
        let empty_crl_der = fs::read(directory.join("empty.crl.der")).unwrap();
        let revoked_crl_der = fs::read(directory.join("revoked.crl.der")).unwrap();
        Self {
            _root: root,
            openssl,
            directory,
            root_der,
            tsa_der,
            alternate_der,
            invalid_eku_der,
            rsa_der,
            empty_crl_der,
            revoked_crl_der,
        }
    }

    fn profile_json(&self, trust_root: &[u8]) -> String {
        self.profile_json_with_revocation(trust_root, &[], false)
    }

    fn profile_json_with_revocation(
        &self,
        trust_root: &[u8],
        crls: &[&[u8]],
        required: bool,
    ) -> String {
        serde_json::to_string(&serde_json::json!({
            "profile": "aigc-proof.tsa-trust-profile.v1",
            "source_label": "Local RFC 3161 test TSA",
            "endpoint": "https://localhost:9443/rfc3161",
            "endpoint_scope": "loopback_test",
            "allowed_policy_oids": ["1.2.3.4.1", "1.2.3.4.2"],
            "roots_der_base64": [STANDARD.encode(trust_root)],
            "intermediates_der_base64": [],
            "https_roots_der_base64": [STANDARD.encode(&self.root_der)],
            "revocation": {
                "crls_der_base64": crls.iter().map(|value| STANDARD.encode(value)).collect::<Vec<_>>(),
                "ocsp_responses_der_base64": [],
                "required": required
            },
            "effective_at": "2026-01-01T00:00:00Z",
            "expires_at": "2035-01-01T00:00:00Z"
        }))
        .unwrap()
    }

    fn respond(&self, request_der: &[u8], name: &str) -> Vec<u8> {
        let request = self.directory.join(format!("{name}.tsq"));
        let response = self.directory.join(format!("{name}.tsr"));
        fs::write(&request, request_der).unwrap();
        run(
            &self.openssl,
            &self.directory,
            &[
                "ts",
                "-reply",
                "-config",
                "tsa.conf",
                "-section",
                "tsa_config1",
                "-queryfile",
                request.file_name().unwrap().to_str().unwrap(),
                "-out",
                response.file_name().unwrap().to_str().unwrap(),
            ],
        );
        run(
            &self.openssl,
            &self.directory,
            &[
                "ts",
                "-query",
                "-in",
                request.file_name().unwrap().to_str().unwrap(),
                "-text",
            ],
        );
        run(
            &self.openssl,
            &self.directory,
            &[
                "ts",
                "-verify",
                "-queryfile",
                request.file_name().unwrap().to_str().unwrap(),
                "-in",
                response.file_name().unwrap().to_str().unwrap(),
                "-CAfile",
                "root.pem",
                "-untrusted",
                "tsa.pem",
            ],
        );
        fs::read(response).unwrap()
    }
}

#[test]
fn protocol_04_timestamp_round_trip_and_fail_closed_states() {
    let fixture = TsaFixture::create();
    let profile = parse_tsa_profile(&fixture.profile_json(&fixture.root_der)).unwrap();
    let root = tempdir().unwrap();
    let workspace = root.path().join("workspace");
    let source = root.path().join("asset.txt");
    fs::write(&source, b"trusted time integration asset").unwrap();
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: Some("trusted time".to_owned()),
        created_at: "2026-07-16T00:00:00Z".to_owned(),
    })
    .unwrap();
    add_asset(AddAssetOptions {
        workspace: workspace.clone(),
        source,
        role: AssetRole::Input,
        asset_id: Uuid::new_v4().to_string(),
        media_type: "text/plain".to_owned(),
    })
    .unwrap();
    let signer = SignerService::new(MemoryStore::default());
    signer.create("Timestamp test creator").unwrap();
    let package = root.path().join("planned.aigcproof");
    seal_signed_workspace_with_timestamp(
        SealOptions {
            workspace,
            output: package.clone(),
            proof_id: Uuid::new_v4().urn().to_string(),
            created_at: "2026-07-16T00:00:00Z".to_owned(),
        },
        &signer,
        &profile,
        "1.2.3.4.1",
    )
    .unwrap();

    let now = current_timestamp().unwrap();
    let absent = verify_package_with_profile(
        &package,
        &VerificationLimits::default(),
        now.clone(),
        &profile,
    );
    assert_eq!(absent.status, VerificationStatus::Valid);
    assert_eq!(absent.assurance.trusted_time, TimeAssurance::Absent);

    let prepared = prepare_timestamp_request(
        &package,
        &profile,
        &VerificationLimits::default(),
        now.clone(),
    )
    .unwrap();
    let request_der = STANDARD
        .decode(&prepared.disclosure.request_der_base64)
        .unwrap();
    let response = fixture.respond(&request_der, "valid");
    let timestamped = root.path().join("timestamped.aigcproof");
    let preserved_before = protected_entries(&package);
    attach_timestamp_response(
        &package,
        &timestamped,
        &response,
        &profile,
        &VerificationLimits::default(),
        now.clone(),
    )
    .unwrap();
    assert_eq!(preserved_before, protected_entries(&timestamped));
    let verified = verify_package_with_profile(
        &timestamped,
        &VerificationLimits::default(),
        now.clone(),
        &profile,
    );
    assert_eq!(verified.status, VerificationStatus::Valid);
    assert_eq!(verified.assurance.trusted_time, TimeAssurance::ValidTrusted);
    assert_eq!(verified.trusted_time.unwrap().requested_policy, "1.2.3.4.1");

    let original_descriptor = inspect_package(&package, &VerificationLimits::default())
        .unwrap()
        .trusted_timestamp
        .unwrap();
    let signature = read_zip_entry(&package, "security/signatures/creator.cose");
    let malformed_der = proof_core::verify_timestamp_strict(
        &[0x30, 0x01, 0xff],
        &signature,
        &original_descriptor,
        &profile,
        &now,
    );
    assert_eq!(malformed_der.state, TimeAssurance::Malformed);
    let oversized = proof_core::verify_timestamp_strict(
        &vec![0; 1024 * 1024 + 1],
        &signature,
        &original_descriptor,
        &profile,
        &now,
    );
    assert_eq!(oversized.state, TimeAssurance::Malformed);
    let imprint_mismatch = proof_core::verify_timestamp_strict(
        &response,
        b"substituted creator signature",
        &original_descriptor,
        &profile,
        &now,
    );
    assert_eq!(imprint_mismatch.state, TimeAssurance::ImprintMismatch);
    let mut policy_descriptor = original_descriptor.clone();
    policy_descriptor.requested_policy = "1.2.3.4.2".to_owned();
    let policy_mismatch = proof_core::verify_timestamp_strict(
        &response,
        &signature,
        &policy_descriptor,
        &profile,
        &now,
    );
    assert_eq!(policy_mismatch.state, TimeAssurance::PolicyMismatch);
    let invalid_signature = proof_core::verify_timestamp_strict(
        &corrupt_cms_signature(&response),
        &signature,
        &original_descriptor,
        &profile,
        &now,
    );
    assert_eq!(invalid_signature.state, TimeAssurance::InvalidSignature);
    let invalid_eku = proof_core::verify_timestamp_strict(
        &replace_signer_certificate(&response, &fixture.invalid_eku_der),
        &signature,
        &original_descriptor,
        &profile,
        &now,
    );
    assert_eq!(invalid_eku.state, TimeAssurance::InvalidEku);
    let invalid_ess = proof_core::verify_timestamp_strict(
        &replace_signer_certificate(&response, &fixture.alternate_der),
        &signature,
        &original_descriptor,
        &profile,
        &now,
    );
    assert_eq!(invalid_ess.state, TimeAssurance::InvalidEss);
    let unsupported_algorithm = proof_core::verify_timestamp_strict(
        &replace_signer_certificate(&response, &fixture.rsa_der),
        &signature,
        &original_descriptor,
        &profile,
        &now,
    );
    assert_eq!(
        unsupported_algorithm.state,
        TimeAssurance::UnsupportedAlgorithm
    );
    let valid_crl_profile = parse_tsa_profile(&fixture.profile_json_with_revocation(
        &fixture.root_der,
        &[&fixture.empty_crl_der],
        true,
    ))
    .unwrap();
    let mut valid_crl_descriptor = original_descriptor.clone();
    valid_crl_descriptor.tsa_profile_sha256 = valid_crl_profile.digest.clone();
    let valid_crl = proof_core::verify_timestamp_strict(
        &response,
        &signature,
        &valid_crl_descriptor,
        &valid_crl_profile,
        &now,
    );
    assert_eq!(valid_crl.state, TimeAssurance::ValidTrusted);
    assert_eq!(
        valid_crl.evidence.revocation,
        proof_schema::RevocationEvidenceState::ValidCrl
    );
    let revoked_profile = parse_tsa_profile(&fixture.profile_json_with_revocation(
        &fixture.root_der,
        &[&fixture.revoked_crl_der],
        true,
    ))
    .unwrap();
    let mut revoked_descriptor = original_descriptor.clone();
    revoked_descriptor.tsa_profile_sha256 = revoked_profile.digest.clone();
    let revoked = proof_core::verify_timestamp_strict(
        &response,
        &signature,
        &revoked_descriptor,
        &revoked_profile,
        &now,
    );
    assert_eq!(revoked.state, TimeAssurance::InvalidChain);
    assert_eq!(
        revoked.evidence.revocation,
        proof_schema::RevocationEvidenceState::Revoked
    );
    let required_revocation_profile =
        parse_tsa_profile(&fixture.profile_json_with_revocation(&fixture.root_der, &[], true))
            .unwrap();
    let mut required_revocation_descriptor = original_descriptor.clone();
    required_revocation_descriptor.tsa_profile_sha256 = required_revocation_profile.digest.clone();
    let required_revocation = proof_core::verify_timestamp_strict(
        &response,
        &signature,
        &required_revocation_descriptor,
        &required_revocation_profile,
        &now,
    );
    assert_eq!(
        required_revocation.state,
        TimeAssurance::IndeterminateRevocation
    );
    let mut ocsp_profile_json: serde_json::Value =
        serde_json::from_str(&fixture.profile_json(&fixture.root_der)).unwrap();
    ocsp_profile_json["revocation"]["ocsp_responses_der_base64"] =
        serde_json::json!([STANDARD.encode(b"unsupported OCSP fixture")]);
    let ocsp_profile =
        parse_tsa_profile(&serde_json::to_string(&ocsp_profile_json).unwrap()).unwrap();
    let mut ocsp_descriptor = original_descriptor.clone();
    ocsp_descriptor.tsa_profile_sha256 = ocsp_profile.digest.clone();
    let ocsp = proof_core::verify_timestamp_strict(
        &response,
        &signature,
        &ocsp_descriptor,
        &ocsp_profile,
        &now,
    );
    assert_eq!(ocsp.state, TimeAssurance::IndeterminateRevocation);

    let mut malformed = response.clone();
    *malformed.last_mut().unwrap() ^= 1;
    let error = attach_timestamp_response(
        &package,
        &root.path().join("malformed.aigcproof"),
        &malformed,
        &profile,
        &VerificationLimits::default(),
        now.clone(),
    )
    .unwrap_err();
    assert!(
        error.code.starts_with("TRUSTED_TIMESTAMP_")
            || error.code == "TIMESTAMPED_PACKAGE_SELF_CHECK_FAILED"
    );

    let mut descriptor = original_descriptor.clone();
    descriptor.nonce = "00".repeat(16);
    let nonce_request = build_timestamp_request(&signature, &descriptor, &profile).unwrap();
    let nonce_response = fixture.respond(
        &STANDARD.decode(nonce_request.request_der_base64).unwrap(),
        "nonce-mismatch",
    );
    let nonce_result = proof_core::verify_timestamp_strict(
        &nonce_response,
        &signature,
        &inspect_package(&package, &VerificationLimits::default())
            .unwrap()
            .trusted_timestamp
            .unwrap(),
        &profile,
        &now,
    );
    assert_eq!(nonce_result.state, TimeAssurance::NonceMismatch);

    let wrong_root_profile = parse_tsa_profile(&fixture.profile_json(&fixture.tsa_der)).unwrap();
    let wrong_chain = verify_package_with_profile(
        &timestamped,
        &VerificationLimits::default(),
        now.clone(),
        &wrong_root_profile,
    );
    assert_eq!(wrong_chain.status, VerificationStatus::Valid);
    assert_eq!(wrong_chain.assurance.trusted_time, TimeAssurance::Untrusted);
    let mut wrong_root_descriptor = original_descriptor;
    wrong_root_descriptor.tsa_profile_sha256 = wrong_root_profile.digest.clone();
    let invalid_chain = proof_core::verify_timestamp_strict(
        &response,
        &signature,
        &wrong_root_descriptor,
        &wrong_root_profile,
        &now,
    );
    assert_eq!(invalid_chain.state, TimeAssurance::InvalidChain);

    let stale = verify_package_with_profile(
        &timestamped,
        &VerificationLimits::default(),
        "2036-01-01T00:00:00Z".to_owned(),
        &profile,
    );
    assert_eq!(stale.status, VerificationStatus::Valid);
    assert_eq!(stale.assurance.trusted_time, TimeAssurance::ExpiredOrStale);
}

fn openssl_path() -> PathBuf {
    if let Some(value) = std::env::var_os("OPENSSL") {
        return value.into();
    }
    #[cfg(target_os = "windows")]
    {
        let git = PathBuf::from(r"C:\Program Files\Git\usr\bin\openssl.exe");
        if git.is_file() {
            return git;
        }
    }
    PathBuf::from("openssl")
}

fn issue_certificate_variant(
    openssl: &Path,
    directory: &Path,
    request: &str,
    pem_output: &str,
    der_output: &str,
    extension_file: &str,
    serial: &str,
) {
    run(
        openssl,
        directory,
        &[
            "x509",
            "-req",
            "-in",
            request,
            "-CA",
            "root.pem",
            "-CAkey",
            "root.key",
            "-set_serial",
            serial,
            "-out",
            pem_output,
            "-days",
            "365",
            "-sha256",
            "-extfile",
            extension_file,
        ],
    );
    run(
        openssl,
        directory,
        &[
            "x509", "-in", pem_output, "-outform", "DER", "-out", der_output,
        ],
    );
}

fn run(program: &Path, directory: &Path, arguments: &[&str]) {
    let output = Command::new(program)
        .current_dir(directory)
        .args(arguments)
        .output()
        .unwrap_or_else(|error| panic!("failed to run {}: {error}", program.display()));
    assert!(
        output.status.success(),
        "{} {:?} failed\nstdout: {}\nstderr: {}",
        program.display(),
        arguments,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn command_output(program: &Path, directory: &Path, arguments: &[&str]) -> String {
    let output = Command::new(program)
        .current_dir(directory)
        .args(arguments)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{} {:?} failed",
        program.display(),
        arguments
    );
    String::from_utf8(output.stdout).unwrap()
}

fn mutate_timestamp_signed_data(
    response_der: &[u8],
    mutate: impl FnOnce(&mut SignedData),
) -> Vec<u8> {
    let mut response = TimeStampResp::from_der(response_der).unwrap();
    let token = response.time_stamp_token.as_mut().unwrap();
    let mut signed_data = token.content.decode_as::<SignedData>().unwrap();
    mutate(&mut signed_data);
    token.content = Any::encode_from(&signed_data).unwrap();
    response.to_der().unwrap()
}

fn replace_signer_certificate(response_der: &[u8], certificate_der: &[u8]) -> Vec<u8> {
    mutate_timestamp_signed_data(response_der, |signed_data| {
        let identifier = signed_data.signer_infos.0.get(0).unwrap().sid.clone();
        let replacement = Certificate::from_der(certificate_der).unwrap();
        let certificates = signed_data.certificates.as_mut().unwrap();
        let mut choices = certificates.0.clone().into_vec();
        let signer = choices
            .iter_mut()
            .find(|choice| match (choice, &identifier) {
                (
                    CertificateChoices::Certificate(certificate),
                    SignerIdentifier::IssuerAndSerialNumber(expected),
                ) => {
                    certificate.tbs_certificate.issuer == expected.issuer
                        && certificate.tbs_certificate.serial_number == expected.serial_number
                }
                _ => false,
            })
            .unwrap();
        *signer = CertificateChoices::Certificate(replacement);
        certificates.0 = der::asn1::SetOfVec::from_iter(choices).unwrap();
    })
}

fn corrupt_cms_signature(response_der: &[u8]) -> Vec<u8> {
    mutate_timestamp_signed_data(response_der, |signed_data| {
        let mut signers = signed_data.signer_infos.0.clone().into_vec();
        let signer = signers.get_mut(0).unwrap();
        let mut signature = signer.signature.as_bytes().to_vec();
        let last = signature.last_mut().unwrap();
        *last ^= 1;
        signer.signature = OctetString::new(signature).unwrap();
        signed_data.signer_infos.0 = der::asn1::SetOfVec::from_iter(signers).unwrap();
    })
}

fn protected_entries(package: &Path) -> Vec<(String, Vec<u8>)> {
    let archive = ZipArchive::new(fs::File::open(package).unwrap()).unwrap();
    let names = (0..archive.len())
        .map(|index| archive.name_for_index(index).unwrap().to_owned())
        .filter(|name| {
            name == "manifest.json"
                || name.starts_with("security/keys/")
                || name.starts_with("security/signatures/")
        })
        .collect::<Vec<_>>();
    names
        .into_iter()
        .map(|name| {
            let bytes = read_zip_entry(package, &name);
            (name, bytes)
        })
        .collect()
}

fn read_zip_entry(package: &Path, name: &str) -> Vec<u8> {
    use std::io::Read as _;
    let mut archive = ZipArchive::new(fs::File::open(package).unwrap()).unwrap();
    let mut entry = archive.by_name(name).unwrap();
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).unwrap();
    bytes
}
