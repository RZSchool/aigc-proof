# AIGC-Proof Specification 0.2

## Scope and assurance

Version 0.2 is an unsigned Internal Integrity profile. It records a local workflow, computes asset digests and a creation-event hash chain, packages canonical protocol data, and verifies internal consistency offline.

It does not verify creator identity, a digital signature, trusted time, originality, source-material authorization, copyright, ownership, or legal validity. Whole-package reconstruction remains possible.

## Algorithms and encoding

- spec_version: 0.2.0
- Asset and event digest: SHA-256
- Digest encoding: exactly 64 lowercase hexadecimal characters
- Canonical JSON: RFC 8785 JCS, UTF-8, no BOM or trailing bytes
- Time: RFC 3339 normalized to UTC with uppercase T and Z
- Container: standard ZIP with ZIP64 support when size/count fields require it

Duplicate JSON object member names are invalid before canonicalization.
JCS input follows I-JSON constraints and uses ECMAScript-compatible number serialization
and UTF-16 property-name ordering. The committed vectors include the RFC 8785 Section 3.2
number, escaping, Unicode, and non-BMP sorting examples.

## Manifest

manifest.json contains spec_version, proof_id as a lowercase UUID URN, created_at, tool, project, a stable package_path-sorted assets array, and event_chain.

Each asset contains asset_id, role, package_path, original_name, media_type, size_bytes, and
sha256. Asset IDs are unique canonical lowercase UUIDs. package_path is under
assets/<role>/, is sorted by UTF-8 byte order, and obeys portable Windows, Linux, and macOS
component rules. Original external absolute paths are never stored. Asset roles are input,
output, reference, license, and other.

event_chain contains algorithm sha-256, event_count, and root_hash. With no events, count is 0 and root is null.

## Events

events.json is a canonical array. The first event has sequence 1 and previous_event_hash null. Each later sequence increments by one and references the prior event_hash.
Event IDs are unique canonical lowercase UUIDs.

The event hash input contains exactly:

~~~text
event_id
sequence
event_type
created_at
previous_event_hash
payload
~~~

Exclude event_hash, canonicalize that object with RFC 8785 JCS, compute SHA-256, and encode lowercase hexadecimal. Manifest root_hash equals the last event_hash.

## Time

Protocol output is UTC Z form such as 2026-07-10T12:30:45Z or 2026-07-10T12:30:45.123456Z. Parsing accepts a legal numeric offset only for normalization; stored protocol timestamps must already equal their UTC Z normalization. Space separators, missing zones, illegal calendar values, lowercase separators, and trailing text are invalid.

Times are local observations, not trusted timestamp evidence.

## Verification result

Status is valid, invalid, or error. valid means all integrity stages passed and errors is
empty. invalid means package bytes or protocol data failed validation. error is reserved for
an operational failure that prevented evaluation, such as an unreadable input; malformed or
hostile package content is invalid, not error. assurance.internal_integrity is respectively
valid, invalid, or not_evaluated. The remaining assurance fields are fixed:
creator_identity not_verified, digital_signature not_present, trusted_time not_present, and
originality not_evaluated.

Errors use stable uppercase machine codes, an optional protocol path, and a human message.
