use base64::{Engine as _, engine::general_purpose::STANDARD};
use proof_core::{canonical_json, event_digest, sha256_bytes};
use proof_schema::{Event, parse_json_strict};
use serde_json::Value;

#[test]
fn committed_hash_jcs_and_event_vectors_match() {
    let hash_input_hex = include_str!("../../../tests/test-vectors/hashes/input.hex").trim();
    assert_eq!(hash_input_hex, "616263");
    assert_eq!(
        sha256_bytes(b"abc"),
        include_str!("../../../tests/test-vectors/hashes/expected-sha256.txt").trim()
    );

    let canonical_input: Value = parse_json_strict(include_bytes!(
        "../../../tests/test-vectors/canonical-json/input.json"
    ))
    .unwrap();
    let canonical = canonical_json(&canonical_input).unwrap();
    assert_eq!(
        canonical,
        include_str!("../../../tests/test-vectors/canonical-json/expected.jcs.json")
            .trim()
            .as_bytes()
    );
    assert_eq!(
        sha256_bytes(&canonical),
        include_str!("../../../tests/test-vectors/canonical-json/expected-sha256.txt").trim()
    );

    let rfc_input: Value = parse_json_strict(include_bytes!(
        "../../../tests/test-vectors/canonical-json/rfc8785-input.json"
    ))
    .unwrap();
    assert_eq!(
        canonical_json(&rfc_input).unwrap(),
        include_str!("../../../tests/test-vectors/canonical-json/rfc8785-expected.jcs.json")
            .trim()
            .as_bytes()
    );

    let sorting_input: Value = parse_json_strict(include_bytes!(
        "../../../tests/test-vectors/canonical-json/rfc8785-sorting-input.json"
    ))
    .unwrap();
    assert_eq!(
        canonical_json(&sorting_input).unwrap(),
        include_str!(
            "../../../tests/test-vectors/canonical-json/rfc8785-sorting-expected.jcs.json"
        )
        .trim()
        .as_bytes()
    );

    let input: Value = parse_json_strict(include_bytes!(
        "../../../tests/test-vectors/event-chain/input-event-without-hash.json"
    ))
    .unwrap();
    let event = Event {
        event_id: input["event_id"].as_str().unwrap().to_owned(),
        sequence: input["sequence"].as_u64().unwrap(),
        event_type: input["event_type"].as_str().unwrap().to_owned(),
        created_at: input["created_at"].as_str().unwrap().to_owned(),
        previous_event_hash: None,
        payload: input["payload"].clone(),
        event_hash: "0".repeat(64),
    };
    assert_eq!(
        event_digest(&event).unwrap(),
        include_str!("../../../tests/test-vectors/event-chain/expected-event-hash.txt").trim()
    );
}

#[test]
fn stable_conformance_manifest_matches_committed_vectors() {
    let manifest: Value =
        parse_json_strict(include_bytes!("../../../docs/CONFORMANCE-MANIFEST.json")).unwrap();
    assert_eq!(manifest["profile"], "aigc-proof.conformance-manifest.v1");
    assert_eq!(manifest["protocol_version"], "1.0.0");
    assert_eq!(manifest["rust_toolchain"], "1.88.0");
    let sources = manifest["sources"].as_array().unwrap();
    let c2pa_runtime = sources
        .iter()
        .find(|source| source["name"] == "c2pa-rs runtime")
        .unwrap();
    assert_eq!(c2pa_runtime["version"], "0.89.3");
    assert_eq!(c2pa_runtime["tag"], "c2pa-v0.89.3");
    assert_eq!(
        c2pa_runtime["tag_object"],
        "4b9caf5398ca0e0106f989306daa00a9955504ea"
    );
    assert_eq!(
        c2pa_runtime["peeled_commit"],
        "e2c90ec7f1fd0a3c90adfaf93107e19abd5383b8"
    );
    assert_eq!(
        c2pa_runtime["crate_sha256"],
        "033a638e07c1c6194f0e0964e2cf0c1848109b25cc77d7070a9417e59005b010"
    );
    let c2pa_compatibility = sources
        .iter()
        .find(|source| source["name"] == "AP-033 c2pa-rs compatibility corpus")
        .unwrap();
    assert_eq!(c2pa_compatibility["version"], "0.85.0");
    assert_eq!(
        c2pa_compatibility["peeled_commit"],
        "3f40cdd22b60bf955d531b0301604e3f257e0a19"
    );

    let vectors = &manifest["local_vectors"];
    assert_eq!(
        sha256_bytes(include_bytes!(
            "../../../tests/test-vectors/canonical-json/rfc8785-input.json"
        )),
        vectors["rfc8785_input_sha256"].as_str().unwrap()
    );
    assert_eq!(
        sha256_bytes(include_bytes!(
            "../../../tests/test-vectors/canonical-json/rfc8785-expected.jcs.json"
        )),
        vectors["rfc8785_expected_sha256"].as_str().unwrap()
    );
    assert_eq!(
        sha256_bytes(include_bytes!(
            "../../../tests/test-vectors/creator-signature/ed25519-cose-sign1.json"
        )),
        vectors["creator_signature_vector_sha256"].as_str().unwrap()
    );
    assert_eq!(
        sha256_bytes(include_bytes!(
            "../../../tests/vectors/official-identity/ap034-trust.json"
        )),
        vectors["ap034_official_trust_checked_file_sha256"]
            .as_str()
            .unwrap()
    );
    assert_eq!(
        sha256_bytes(include_bytes!(
            "../../../tests/vectors/official-identity/independent-trust.json"
        )),
        vectors["independent_official_trust_sha256"]
            .as_str()
            .unwrap()
    );

    for (encoded, field) in [
        (
            include_str!(
                "../../../tests/vectors/official-identity/independent-attestation.cose.b64"
            ),
            "independent_official_attestation_decoded_sha256",
        ),
        (
            include_str!("../../../tests/vectors/official-identity/independent-status.cose.b64"),
            "independent_official_status_decoded_sha256",
        ),
    ] {
        let decoded = STANDARD.decode(encoded.trim()).unwrap();
        assert_eq!(sha256_bytes(&decoded), vectors[field].as_str().unwrap());
    }
}
