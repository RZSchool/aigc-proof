# Assurance Levels

## 0.2 Internal Integrity

Can evaluate:

- Package structure against the 0.2 protocol
- Asset bytes against Manifest sizes and SHA-256
- Event continuity, hashes, count, and root
- Internal inconsistencies and unsafe ZIP structure

Cannot evaluate:

- Creator identity
- Earliest creation time or trusted timestamp
- Digital signature
- Originality
- Source-material authorization
- Whole-package reconstruction
- Rights ownership or legal validity
- Official verification

A valid report must preserve these assurance fields:

~~~json
{
  "internal_integrity": "valid",
  "creator_identity": "not_verified",
  "digital_signature": "not_present",
  "trusted_time": "not_present",
  "originality": "not_evaluated"
}
~~~
