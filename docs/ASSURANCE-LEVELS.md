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

## Protocol 0.5: optional C2PA provenance observation

Protocol 0.5 may include one or more digest-bound `c2pa_observation` events for JPEG, PNG, or WebP media with claim v2 or read-only claim v1. Each observation separates media/manifest validation, C2PA signer trust, and C2PA timestamp trust. Report states are `absent`, `observed_invalid`, `observed_valid_untrusted`, and `observed_trusted`.

An observed state describes the exact media and manifest store at the recorded time against the exact imported C2PA trust snapshots. It does not inherit authority from the local creator key or RFC 3161 snapshot, and it does not upgrade a package whose internal integrity or creator signature is invalid.

## Protocol 1.0: stable independent assurance

Protocol 1.0 retains Internal Integrity, creator signature, RFC 3161, and C2PA as separate layers and adds optional external official identity evidence. Trusted time is optional for a new 1.0 package; its absence does not imply acquisition failure.

Official identity states are `absent`, `unsupported`, `malformed`, `invalid`, `untrusted`, `revoked`, `expired`, `indeterminate`, and `valid_trusted`. Only `valid_trusted` means the attestation signature, explicitly selected issuer key, creator-key fingerprint, purpose/consent, time interval, signed status, freshness and rollback policy all passed. `revoked` and `expired` remain distinct; a missing, stale, or incomplete status is `indeterminate`, never valid.

The Workbench groups these results for readability but exposes no combined score or success badge. A valid official claim cannot repair invalid Internal Integrity, creator signature, trusted time, or C2PA evidence, and failure in one optional layer cannot rewrite another layer's result.

No version evaluates factual truth, earliest creation time, originality, authorship, source authorization, copyright, ownership, legal validity, or non-infringement. C2PA provenance validity and a bounded official identity claim are not any of those claims.
