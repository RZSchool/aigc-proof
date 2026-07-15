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

Neither version evaluates real identity, earliest creation time, trusted timestamp, originality, source authorization, copyright, ownership, legal validity, or official verification.
