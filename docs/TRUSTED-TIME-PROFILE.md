# RFC 3161 Trusted Time Profile 1

## Assurance boundary

Protocol 0.4 introduced externally witnessed time over the exact tagged creator `COSE_Sign1` bytes; protocol 0.5 retained its mandatory plan and protocol 1.0 retains it as an optional independent layer. A `valid_trusted` result means the RFC 3161 signer, chain, bound request values, certificate profile, evidence time, and imported trust snapshot all passed the checks below. It does not identify the creator or establish originality, copyright, ownership, authorization, C2PA provenance, or official identity.

Timestamp assurance is independent of creator-signature and package-integrity assurance. Missing, failed, stale, untrusted, or malformed timestamp evidence never turns a valid creator signature into an invalid one.

## Signed timestamp plan

Before creator signing, protocol 0.4 adds `security.trusted_timestamp` with:

- profile `aigc-proof.trusted-time.rfc3161.v1`;
- path `security/timestamps/<signature-id>.tsr`;
- a cryptographically random 128-bit unsigned nonce encoded as 32 lowercase hexadecimal digits;
- one requested policy OID or the explicit `any` marker; and
- SHA-256 of the exact strict-JCS TSA trust snapshot.

The RFC 3161 request uses SHA-256 of the exact tagged creator COSE bytes as `messageImprint`, includes the signed nonce, and sets `certReq=true`. Only SHA-256 request imprints are generated or accepted.

## Portable TSA trust snapshot

`aigc-proof.tsa-trust-profile.v1` is explicit local user or administrator data. It contains a source label, one HTTPS endpoint, endpoint scope, allowed policy OIDs, non-empty TSA roots, optional intermediates, optional independent HTTPS roots, CRL/OCSP evidence, a revocation-required flag, effective time, and expiry time. Duplicate JSON members, noncanonical values, invalid DER, duplicate certificates, empty TSA roots, credentials/fragments in the endpoint, or a scope/host mismatch are rejected. The strict-JCS SHA-256 digest is shown to the user and bound into the Manifest.

The product ships no production TSA endpoint or trust root and performs no trust-list update. Workbench imports a snapshot into the current process only; it is not copied into the proof package or persisted in SQLite. A verifier must obtain the exact snapshot through an independent trusted channel.

## Acquisition boundary

The Rust CLI, schema/core crates, napi-rs bridge, Utility Process, preload, and renderer do not perform HTTP. Workbench Electron Main owns the only adapter. It accepts only the endpoint from the imported snapshot, requires HTTPS, forbids URL credentials/fragments and redirects, uses the separately imported HTTPS roots when supplied, applies a 10-second connection timeout and 30-second total timeout, requires HTTP 200 and `application/timestamp-reply`, and caps the response at 1 MiB.

Before sending, normal Workbench launch displays the endpoint, policy, and exact SHA-256 imprint and states that the random nonce will be disclosed. Cancellation aborts the request and publishes no package. Ordinary verification never opens a socket.

## Strict verification

Verification requires all of the following:

1. bounded, well-formed DER `TimeStampResp`, CMS `SignedData`, and `TSTInfo`;
2. exactly one signer and an included signer certificate;
3. SHA-256 imprint over the exact creator COSE bytes;
4. exact 128-bit nonce and requested/allowed policy match;
5. CMS signature and ESS `SigningCertificateV2` SHA-256 binding to exactly that signer;
6. a critical EKU containing exactly `timeStamping`, certificate validity at `genTime`, and an ECDSA P-256 or P-384 signer;
7. a chain to the non-empty explicit TSA roots with no ambient operating-system roots; and
8. all supplied CRL evidence, with required-but-missing or unsupported OCSP evidence reported fail-closed as indeterminate.

Unsupported RSA or algorithm paths are reported as `unsupported_algorithm`; they are not guessed or silently accepted. Profile effective/expiry bounds are evaluated explicitly. The report retains the granted policy, `genTime`, source label, timestamp path, trust-snapshot digest, and revocation-evidence state.

## Attachment and portability

Attachment verifies the response before publication, writes a new no-clobber `.aigcproof`, copies `manifest.json`, public key, and creator signature bytes exactly, and adds only the predeclared DER entry. The output is self-verified before success is returned. An old package must be migrated by creating and signing new contemporary 1.0 evidence; it cannot be relabeled or backdated in place.

## Privacy disclosure

The TSA receives the creator-signature SHA-256 digest, random nonce, requested policy, and normal HTTPS connection metadata. It does not receive the Manifest, assets, prompt, display label, public key, or creator signature bytes from this adapter. A TSA can still correlate network identity and request time, so acquisition is always explicit and optional.
