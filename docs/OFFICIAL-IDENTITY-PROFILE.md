# Official Identity Attestation Profile v1

## Claim boundary

Protocol 1.0 can verify an optional identity attestation entirely offline. A successful result means a trusted issuer key signed a bounded claim that links an opaque synthetic/person/organization subject, display claim, local creator-key fingerprint, purpose, consent record, proofing-method class, and validity interval, and that an explicit signed status snapshot currently marks the attestation valid.

It does not establish authorship, factual truth, originality, ownership, copyright, permission, legal identity outside the issuer's stated method, or non-infringement. It never repairs another assurance failure and is never combined into one score.

## Portable artifacts

The verifier accepts three explicit local inputs, each no larger than 64 KiB:

- `aigc-proof.official-attestation.v1`: tagged deterministic `COSE_Sign1` with an embedded exact RFC 8785 JCS payload.
- `aigc-proof.official-issuer-trust.v1`: strict duplicate-free JSON naming one issuer, key ID, Ed25519 public key, trust sequence, validity interval, and key state.
- `aigc-proof.official-status-snapshot.v1`: tagged deterministic `COSE_Sign1` with an embedded exact JCS payload, issuer, monotonic sequence, predecessor digest, generation/effective times, and a sorted unique bounded status list.

The protected COSE header contains only EdDSA (`alg = -8`) and the exact trust-snapshot key ID; the unprotected header is empty. Attestation external AAD is the exact bytes `AIGC-Proof Official Attestation v1\0`. Status external AAD is `AIGC-Proof Official Status Snapshot v1\0`. Signatures are strict Ed25519. Untagged/noncanonical CBOR, detached or non-JCS payloads, extra headers, wrong key IDs, wrong AAD, and substituted bytes fail closed.

The public verifier has no private-service dependency. It does not fetch status, roots, proofing records, accounts, endpoints, or remote content. The official business API and signing keys are not part of this repository or runtime.

## Verification policy

The caller supplies the expected creator-key fingerprint, purpose, explicit Unix verification time, minimum trust/status sequences, optional expected predecessor digest, and maximum status age. Verification requires:

1. A supported trust profile and active or retired Ed25519 issuer key valid at issuance and verification time.
2. A valid attestation signature whose issuer and key ID match that explicit trust snapshot.
3. Exact creator fingerprint, purpose, consent-purpose, and consent-time binding.
4. A valid issue/expiry interval and supported `offline_snapshot` status class.
5. A valid status signature from the same issuer/key, a sequence at or above the caller rollback floor, and the expected predecessor when supplied.
6. A fresh, non-future status snapshot with strictly sorted unique entries and an effective entry for the attestation.

Trust snapshot state and status precedence are explicit. A revoked issuer key is `untrusted` before an attestation signature is accepted. Attestation expiry is reported as `expired`. Missing/stale/incomplete status is `indeterminate`; it never becomes trusted by omission. A verified entry can be `valid`, `revoked`, or `expired`.

## Result and error vocabulary

States are `absent`, `unsupported`, `malformed`, `invalid`, `untrusted`, `revoked`, `expired`, `indeterminate`, and `valid_trusted`. The detailed result includes stable uppercase code/message, bounded claim fields, trust/status sequences, and SHA-256 digests of the exact attestation, issuer-trust, and status bytes. Unknown members and critical COSE headers fail closed; syntactically bounded future profiles/algorithms are `unsupported` rather than guessed.

## Interoperability fixtures

`tests/vectors/official-identity/` contains a deterministic independent valid corpus and the exact sanitized AP-034 producer corpus. The latter is intentionally revoked and records private producer commit `ab427a712009a77cb64b9465b07553b2dd7cd9c0`. The conformance manifest freezes all external corpus commits and local hashes. No fixture contains real personal data or a production key/root.
