# AIGC-Proof Specification 1.0

## Scope

Protocol 1.0 records a local workflow, hashes assets, maintains a creation-event chain, and binds the exact canonical Manifest to a local Ed25519 key. It may independently attach RFC 3161 evidence, include digest-bound C2PA observations, and verify a portable official identity attestation against explicit issuer-trust and signed status snapshots. Package, C2PA, and official-identity verification are offline; RFC 3161 acquisition is the only opt-in network action. No assurance layer substitutes for another.

Protocol 0.5 remains the timestamp-plan/C2PA profile, 0.4 remains timestamp-capable without C2PA observations, 0.3 remains signed without trusted time, and 0.2 remains unsigned Internal Integrity. Older packages cannot gain timestamp, C2PA, or official identity assurance through reinterpretation or in-place rewriting.

## Algorithms and encoding

- Current `spec_version` and workspace version: `1.0.0`.
- Compatible read/verify versions: `0.2.0`, `0.3.0`, `0.4.0`, and `0.5.0`.
- Asset, event, Manifest-signing input, and key fingerprint digest: SHA-256.
- Digest encoding: exactly 64 lowercase hexadecimal characters.
- Canonical JSON: RFC 8785 JCS, UTF-8, no BOM or trailing bytes.
- Time: RFC 3339 normalized to UTC with uppercase `T` and `Z`.
- Container: standard ZIP with ZIP64 when required.
- Creator signature: the separately versioned profile in [SIGNATURE-PROFILE.md](SIGNATURE-PROFILE.md).
- Trusted time: the separately versioned profile in [TRUSTED-TIME-PROFILE.md](TRUSTED-TIME-PROFILE.md).
- C2PA observation: the separately versioned profile in [C2PA-BRIDGE.md](C2PA-BRIDGE.md).
- Official identity: the separately versioned profiles in [OFFICIAL-IDENTITY-PROFILE.md](OFFICIAL-IDENTITY-PROFILE.md).

Duplicate JSON members are invalid before canonicalization. JCS inputs obey I-JSON, ECMAScript-compatible number serialization, and UTF-16 property-name ordering. Committed vectors cover the RFC 8785 examples and the creator-signature profile.

## Manifest

`manifest.json` contains `spec_version`, lowercase UUID-URN `proof_id`, `created_at`, `tool`, `project`, a stable UTF-8-byte-sorted `assets` array, `event_chain`, and security metadata. Protocol 0.3 contains `security.creator_signature`; protocols 0.4 and 0.5 additionally require `security.trusted_timestamp` before signing. Protocol 1.0 requires the creator signature while the timestamp plan is optional. C2PA observations live in the ordinary signed event chain. Official identity artifacts remain external portable evidence and are not silently embedded or fetched.

Each asset contains `asset_id`, `role`, `package_path`, `original_name`, `media_type`, `size_bytes`, and `sha256`. IDs are unique lowercase UUIDs. Paths are portable relative paths under `assets/<role>/`; external absolute paths are never stored. Roles are `input`, `output`, `reference`, `license`, and `other`.

The signature descriptor contains exactly `profile`, `signature_id`, `display_label`, `key_fingerprint`, `public_key_path`, and `signature_path`. Display labels must be non-empty NFC UTF-8, at most 200 bytes, and contain no control or bidirectional-control characters. Non-ASCII labels produce a review warning because visual confusables cannot be eliminated reliably.

The timestamp descriptor contains exactly `profile`, `timestamp_path`, a random 128-bit unsigned `nonce` as 32 lowercase hexadecimal digits, `requested_policy`, and `tsa_profile_sha256`. Its path is `security/timestamps/<signature-id>.tsr`; the profile digest binds the exact strict-JCS trust snapshot used at sealing time. The descriptor is part of the creator-signed Manifest even when acquisition is never attempted or fails.

## Events

`events.json` is a canonical array. The first event has sequence 1 and `previous_event_hash: null`; later events increment by one and reference the prior hash. Event IDs are unique lowercase UUIDs.

The event hash input contains exactly `event_id`, `sequence`, `event_type`, `created_at`, `previous_event_hash`, and `payload`. Exclude `event_hash`, canonicalize with JCS, hash with SHA-256, and encode lowercase hexadecimal. Manifest `root_hash` equals the final event hash; an empty chain has count 0 and null root.

Protocol 0.5 defines event type `c2pa_observation`. Its payload contains the fixed profile identifier, referenced workspace asset ID and exact SHA-256, exact manifest-store SHA-256, `embedded` or explicit `sidecar` source mode, claim version 1 or 2, bounded active-manifest label, independent signer/TSA trust-snapshot SHA-256 values, normalized validation/trust states, and bounded SDK status codes. Arbitrary assertion explanations, certificate subject text, remote content, and soft-binding results are not copied into the event.

Protocol 1.0 retains that event type unchanged. It does not add an official-identity event or package entry: verification consumes explicit external artifacts and reports their digests and independent state, preventing a package from choosing its own trust root or manufacturing historical status.

## Time

Stored observation timestamps must already equal their UTC `Z` normalization. Numeric offsets may be parsed only for normalization. Observation time remains distinct from an RFC 3161 `genTime`; only a fully verified response against the bound trust snapshot produces trusted-time assurance.

## Verification result

Status is `valid`, `invalid`, or `error`. `invalid` covers malformed or hostile package content; `error` is reserved for an operational failure that prevented evaluation.

The report separates `internal_integrity`, `creator_identity`, `digital_signature`, `trusted_time`, `official_identity`, C2PA evidence, and `originality`. A valid signature produces self-asserted creator evidence including label, key fingerprint, profile, and local trust. Local trust is evaluated only against the current operating-system credential record and is not portable authority. C2PA signer trust, C2PA timestamp trust, RFC 3161 trust, creator-key trust, and official identity trust never substitute for one another.

Trusted-time states are independent of creator-signature validity: `absent`, `acquisition_failed`, `malformed`, `imprint_mismatch`, `nonce_mismatch`, `policy_mismatch`, `invalid_signature`, `invalid_chain`, `invalid_eku`, `invalid_ess`, `untrusted`, `expired_or_stale`, `indeterminate_revocation`, `unsupported_algorithm`, or `valid_trusted`. Timestamp failure never downgrades an otherwise valid creator signature or package-integrity result.

Errors use stable uppercase codes, an optional protocol path, and a human message. Warnings never silently upgrade assurance.

C2PA report state is `absent`, `observed_invalid`, `observed_valid_untrusted`, or `observed_trusted`, with the exact normalized observations listed separately. An observed state means only that the signed AIGC-Proof event chain contains one or more structurally valid digest-bound observations; each observation's own `validation_state`, signer trust, and timestamp trust remain visible. C2PA cannot establish factual truth, human identity, authorship, originality, ownership, copyright, permission, or non-infringement.

Official identity state is `absent`, `unsupported`, `malformed`, `invalid`, `untrusted`, `revoked`, `expired`, `indeterminate`, or `valid_trusted`. `valid_trusted` requires the signed attestation and status snapshot, explicit issuer key, creator fingerprint, purpose/consent, issue/expiry window, freshness, rollback floor, and status entry all to pass. It authenticates only that bounded claim; it does not prove authorship, rights, truth, originality, or non-infringement.
