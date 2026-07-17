# Creator Signature Profile

## Protocol versions

Protocol 0.2 remains the unsigned Internal Integrity profile. A 0.2 package must never be reported as signed, identity-verified, certified, notarized, or trusted-time proof.

Protocol 0.3 adds one local creator signature with profile identifier `aigc-proof.creator-signature.cose-ed25519.v1`. It preserves the 0.2 asset and event-chain rules and does not reinterpret existing 0.2 packages.

Protocol 0.4 uses profile identifier `aigc-proof.creator-signature.cose-ed25519.v2`. Its Manifest predeclares the RFC 3161 timestamp request plan before creator signing, and its signature domain is therefore distinct from 0.3. A 0.4 verifier continues to verify 0.3 `v1` signatures under their original rules.

Protocol 0.5 introduced profile `aigc-proof.creator-signature.cose-ed25519.v3` with external AAD `AIGC-PROOF\0CREATOR-SIGNATURE\0v0.5`. Protocol 1.0 retains this already frozen signature profile unchanged; the signed Manifest's exact `spec_version` prevents cross-version reinterpretation. New 1.0 packages may omit the timestamp descriptor, while a 0.5 Manifest still requires it.

## Identity and trust boundary

The creator `display_label` is self-asserted. A valid signature proves only that the holder of the corresponding Ed25519 private key signed the exact canonical Manifest digest under this profile. It does not prove a real name, account, organization, originality, copyright, ownership, authorization, legal validity, or trusted creation time.

`valid_locally_trusted` means the embedded key fingerprint matches the current active key in this installation's operating-system credential store. `valid_untrusted` is still cryptographically valid but has no such local match. Disabled local keys are reported separately. This local trust state is not a public PKI or third-party attestation.

## Key and fingerprint

- Algorithm: Ed25519 / COSE EdDSA (`alg = -8`).
- Key format: deterministic CBOR `COSE_Key` with only `kty = OKP`, `alg = EdDSA`, `crv = Ed25519`, and the 32-byte `x` coordinate.
- Key fingerprint: lowercase hexadecimal SHA-256 of the exact deterministic `COSE_Key` bytes.
- Private-key storage: the operating-system credential store only. The application fails closed when that store is unavailable and does not fall back to files, SQLite, environment variables, or package content.

Creation uses operating-system randomness. Rotation replaces the current private key only after explicit confirmation. Disable removes the private key from the stored record and prevents new signatures. Public-key export never includes private bytes.

## COSE_Sign1 construction

The signed content is the SHA-256 digest of the exact canonical `manifest.json` bytes. The `COSE_Sign1` object is tagged and uses a detached nil payload.

- Protected header: exactly `alg = EdDSA` and `kid = SHA-256(COSE_Key bytes)`.
- Unprotected header: empty.
- External AAD, exact bytes: `AIGC-PROOF\0CREATOR-SIGNATURE\0v0.3` for profile `v1`, `AIGC-PROOF\0CREATOR-SIGNATURE\0v0.4` for profile `v2`, or `AIGC-PROOF\0CREATOR-SIGNATURE\0v0.5` for profile `v3`.
- Signature: 64-byte Ed25519 signature over the standard COSE `Sig_structure` produced from those values.

Verification rejects untagged, malformed, non-deterministically encoded, embedded-payload, extra-header, wrong-algorithm, wrong-`kid`, wrong-key, wrong-domain, substituted-Manifest, and non-64-byte signature inputs. Ed25519 verification uses strict verification.

## Package entries

The Manifest `security.creator_signature` descriptor declares the profile, random 32-byte lowercase-hex signature ID, display label, key fingerprint, public-key path, and signature path. The paths are fixed to:

~~~text
security/keys/<key-fingerprint>.cbor
security/signatures/creator.cose
~~~

Signed 0.3 package entry order is `manifest.json`, sorted assets, `events.json`, the declared public key, then the declared signature. A 0.4 package adds the single timestamp response at its signed, predeclared path after those entries. Missing, extra, duplicate, case-conflicting, oversized, or reordered security entries are invalid.

## Interoperability vector

The frozen deterministic vector is in `tests/test-vectors/creator-signature/ed25519-cose-sign1.json`. It contains only public verification material; no private key bytes are committed as fixture data. Rust tests reproduce the exact `COSE_Key`, fingerprint, and `COSE_Sign1` bytes from an explicitly test-only RFC-style seed, while the release-readiness workflow verifies the committed public vector with an independent implementation.
