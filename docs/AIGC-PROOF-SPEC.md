# AIGC-Proof Specification 0.3

## Scope

Protocol 0.3 records a local workflow, hashes assets, maintains a creation-event chain, and binds the exact canonical Manifest to a local Ed25519 key. Verification is offline. The creator label is self-asserted and trusted time is absent.

Protocol 0.2 remains supported as an unsigned Internal Integrity profile. A 0.2 package cannot contain 0.3 security metadata and must not gain signature or identity assurance through reinterpretation.

## Algorithms and encoding

- Current `spec_version` and workspace version: `0.3.0`.
- Legacy compatible version: `0.2.0`.
- Asset, event, Manifest-signing input, and key fingerprint digest: SHA-256.
- Digest encoding: exactly 64 lowercase hexadecimal characters.
- Canonical JSON: RFC 8785 JCS, UTF-8, no BOM or trailing bytes.
- Time: RFC 3339 normalized to UTC with uppercase `T` and `Z`.
- Container: standard ZIP with ZIP64 when required.
- Creator signature: the separately versioned profile in [SIGNATURE-PROFILE.md](SIGNATURE-PROFILE.md).

Duplicate JSON members are invalid before canonicalization. JCS inputs obey I-JSON, ECMAScript-compatible number serialization, and UTF-16 property-name ordering. Committed vectors cover the RFC 8785 examples and the creator-signature profile.

## Manifest

`manifest.json` contains `spec_version`, lowercase UUID-URN `proof_id`, `created_at`, `tool`, `project`, a stable UTF-8-byte-sorted `assets` array, `event_chain`, and—only in 0.3—`security.creator_signature`.

Each asset contains `asset_id`, `role`, `package_path`, `original_name`, `media_type`, `size_bytes`, and `sha256`. IDs are unique lowercase UUIDs. Paths are portable relative paths under `assets/<role>/`; external absolute paths are never stored. Roles are `input`, `output`, `reference`, `license`, and `other`.

The signature descriptor contains exactly `profile`, `signature_id`, `display_label`, `key_fingerprint`, `public_key_path`, and `signature_path`. Display labels must be non-empty NFC UTF-8, at most 200 bytes, and contain no control or bidirectional-control characters. Non-ASCII labels produce a review warning because visual confusables cannot be eliminated reliably.

## Events

`events.json` is a canonical array. The first event has sequence 1 and `previous_event_hash: null`; later events increment by one and reference the prior hash. Event IDs are unique lowercase UUIDs.

The event hash input contains exactly `event_id`, `sequence`, `event_type`, `created_at`, `previous_event_hash`, and `payload`. Exclude `event_hash`, canonicalize with JCS, hash with SHA-256, and encode lowercase hexadecimal. Manifest `root_hash` equals the final event hash; an empty chain has count 0 and null root.

## Time

Stored timestamps must already equal their UTC `Z` normalization. Numeric offsets may be parsed only for normalization. Time values are local observations, not trusted timestamp evidence.

## Verification result

Status is `valid`, `invalid`, or `error`. `invalid` covers malformed or hostile package content; `error` is reserved for an operational failure that prevented evaluation.

The report separates `internal_integrity`, `creator_identity`, `digital_signature`, `trusted_time`, and `originality`. A valid 0.3 signature produces self-asserted creator evidence including label, key fingerprint, profile, and local trust. Local trust is evaluated only against the current operating-system credential record and is not portable authority.

Errors use stable uppercase codes, an optional protocol path, and a human message. Warnings never silently upgrade assurance.
