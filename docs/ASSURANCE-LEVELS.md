# Assurance Levels

## Protocol 0.2: Internal Integrity

Validates package structure, asset bytes, and event-chain continuity. Creator identity is `not_verified`, digital signature is `not_present`, trusted time is `not_present`, and originality is `not_evaluated`.

## Protocol 0.3: signed local identity

Adds a strict Ed25519 `COSE_Sign1` over the exact canonical Manifest digest. The identity claim is `self_asserted`.

Digital-signature states are distinct:

- `valid_locally_trusted`: valid signature and embedded fingerprint matches the current active local key.
- `valid_untrusted`: valid signature without that local match.
- `disabled`: valid signature matches the locally disabled key record.
- `absent`, `unsupported`, `malformed`, or `invalid`: the signed 0.3 requirement did not pass.
- `not_present`: legacy 0.2 only.

Internal integrity, cryptographic signature validity, and local trust are reported independently. A `valid` 0.3 report requires internal integrity and signature validation to pass. Local trust is not a public PKI.

## Protocol 0.4: optional externally witnessed time

Protocol 0.4 signs a timestamp plan into the Manifest and may append one RFC 3161 response over the exact creator COSE bytes. `valid_trusted` requires the exact nonce, SHA-256 imprint, policy, ESS binding, critical timestamping EKU, ECDSA P-256/P-384 signature, explicit chain, validity at `genTime`, profile time bounds, and available revocation evidence to pass against the bound portable snapshot.

Missing or failed acquisition, malformed/substituted evidence, stale or untrusted evidence, and indeterminate revocation are reported independently and never invalidate an otherwise valid creator signature. Trusted time is evidence that the TSA signed the digest at `genTime`; it is not proof of who created the content or when creation began.

No version evaluates real identity, earliest creation time, originality, source authorization, copyright, ownership, legal validity, C2PA provenance, or official verification.
