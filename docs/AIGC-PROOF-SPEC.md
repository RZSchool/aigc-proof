# AIGC-Proof Specification 0.4

## Scope

Protocol 0.4 records a local workflow, hashes assets, maintains a creation-event chain, binds the exact canonical Manifest to a local Ed25519 key, and may attach RFC 3161 evidence over the exact creator COSE bytes. Acquisition is an explicit network action; verification is offline against an explicit portable TSA trust snapshot. The creator label remains self-asserted.

Protocol 0.3 remains supported as the signed, no-trusted-time profile, and 0.2 remains the unsigned Internal Integrity profile. Older packages cannot gain timestamp assurance through reinterpretation or in-place backdating.

## Algorithms and encoding

- Current `spec_version` and workspace version: `0.4.0`.
- Compatible versions: `0.2.0` and `0.3.0`.
- Asset, event, Manifest-signing input, and key fingerprint digest: SHA-256.
- Digest encoding: exactly 64 lowercase hexadecimal characters.
- Canonical JSON: RFC 8785 JCS, UTF-8, no BOM or trailing bytes.
- Time: RFC 3339 normalized to UTC with uppercase `T` and `Z`.
- Container: standard ZIP with ZIP64 when required.
- Creator signature: the separately versioned profile in [SIGNATURE-PROFILE.md](SIGNATURE-PROFILE.md).
- Trusted time: the separately versioned profile in [TRUSTED-TIME-PROFILE.md](TRUSTED-TIME-PROFILE.md).

Duplicate JSON members are invalid before canonicalization. JCS inputs obey I-JSON, ECMAScript-compatible number serialization, and UTF-16 property-name ordering. Committed vectors cover the RFC 8785 examples and the creator-signature profile.

## Manifest

`manifest.json` contains `spec_version`, lowercase UUID-URN `proof_id`, `created_at`, `tool`, `project`, a stable UTF-8-byte-sorted `assets` array, `event_chain`, and security metadata. Protocol 0.3 contains `security.creator_signature`; protocol 0.4 additionally requires `security.trusted_timestamp` before the Manifest is signed.

Each asset contains `asset_id`, `role`, `package_path`, `original_name`, `media_type`, `size_bytes`, and `sha256`. IDs are unique lowercase UUIDs. Paths are portable relative paths under `assets/<role>/`; external absolute paths are never stored. Roles are `input`, `output`, `reference`, `license`, and `other`.

The signature descriptor contains exactly `profile`, `signature_id`, `display_label`, `key_fingerprint`, `public_key_path`, and `signature_path`. Display labels must be non-empty NFC UTF-8, at most 200 bytes, and contain no control or bidirectional-control characters. Non-ASCII labels produce a review warning because visual confusables cannot be eliminated reliably.

The timestamp descriptor contains exactly `profile`, `timestamp_path`, a random 128-bit unsigned `nonce` as 32 lowercase hexadecimal digits, `requested_policy`, and `tsa_profile_sha256`. Its path is `security/timestamps/<signature-id>.tsr`; the profile digest binds the exact strict-JCS trust snapshot used at sealing time. The descriptor is part of the creator-signed Manifest even when acquisition is never attempted or fails.

## Events

`events.json` is a canonical array. The first event has sequence 1 and `previous_event_hash: null`; later events increment by one and reference the prior hash. Event IDs are unique lowercase UUIDs.

The event hash input contains exactly `event_id`, `sequence`, `event_type`, `created_at`, `previous_event_hash`, and `payload`. Exclude `event_hash`, canonicalize with JCS, hash with SHA-256, and encode lowercase hexadecimal. Manifest `root_hash` equals the final event hash; an empty chain has count 0 and null root.

## Time

Stored observation timestamps must already equal their UTC `Z` normalization. Numeric offsets may be parsed only for normalization. Observation time remains distinct from an RFC 3161 `genTime`; only a fully verified response against the bound trust snapshot produces trusted-time assurance.

## Verification result

Status is `valid`, `invalid`, or `error`. `invalid` covers malformed or hostile package content; `error` is reserved for an operational failure that prevented evaluation.

The report separates `internal_integrity`, `creator_identity`, `digital_signature`, `trusted_time`, and `originality`. A valid signature produces self-asserted creator evidence including label, key fingerprint, profile, and local trust. Local trust is evaluated only against the current operating-system credential record and is not portable authority.

Trusted-time states are independent of creator-signature validity: `absent`, `acquisition_failed`, `malformed`, `imprint_mismatch`, `nonce_mismatch`, `policy_mismatch`, `invalid_signature`, `invalid_chain`, `invalid_eku`, `invalid_ess`, `untrusted`, `expired_or_stale`, `indeterminate_revocation`, `unsupported_algorithm`, or `valid_trusted`. Timestamp failure never downgrades an otherwise valid creator signature or package-integrity result.

Errors use stable uppercase codes, an optional protocol path, and a human message. Warnings never silently upgrade assurance.
