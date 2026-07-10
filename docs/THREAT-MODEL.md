# Threat Model 0.2

## Detected inconsistencies

- Asset size or SHA-256 changes
- Missing, added, or reordered package entries
- Event payload, sequence, link, hash, count, or root changes
- Noncanonical or duplicate-member JSON
- Manifest structure or semantic violations

## Malicious ZIP controls

Container checks cover malformed ZIP, entry count, traversal, absolute/drive/UNC/backslash paths, duplicate entries, case conflicts, duplicate Manifest, explicit symbolic links, non-regular files, encryption, compression methods, one-entry size, total expanded size, structured-file size, and compression ratio.

Unsafe containers stop before content-dependent processing. Safe containers are streamed in place and never extracted.

## Not protected

No creator signature or external witness exists. An attacker can generate a new internally consistent Manifest, event chain, and asset set. A valid report cannot establish identity, authorship, originality, rights, authorization, earliest creation time, trusted time, or legal validity.

SHA-256 collision resistance is assumed for comparison but does not create authenticity. ZIP producer metadata can vary by platform; explicit link metadata is rejected and non-extraction is mandatory, but cross-platform behavior must be tested against the pinned ZIP crate.
