# Rights Protection Product Track

Status: planned; no `RP-*` capability is implemented by protocol 1.0.0 or Workbench 1.0.0.

## Product promise and limits

Rights Protection is a product track built on AIGC-Proof evidence primitives. Its intended flow is:

```text
register -> publish -> detect -> preserve -> review -> export
```

The product may help a user record their materials, detect technical similarities, preserve
observations, and prepare a reviewable evidence export. It cannot prevent all copying, make a file
impossible to repost, prove that a claimant owns copyright, determine originality, decide whether
use is licensed or lawful, or automatically conclude infringement. Every match remains a technical
observation requiring human review and, where appropriate, independent legal assessment.
Durable records, attribution, and later reviewed soft-binding signals may discourage some
low-effort reposting, but deterrence is not copy prevention or access control.

The `RP-*` labels are product stages, not proof-protocol versions. They do not replace or renumber
the protocol roadmap (`0.3 Creator Signature`, `0.4 Trusted Timestamp`, `0.5 C2PA Bridge`, and
`1.0 Stable Specification`) and do not upgrade the assurance of unsigned 0.2.0 packages.

## Independent evidence signals

The system must keep these signals separate in storage, verification, and user-visible reports:

- SHA-256 establishes identical bytes or checks declared package-internal integrity. Any byte
  change produces a different digest.
- Segmented visual and audio perceptual fingerprints estimate similarity after transformations
  such as re-encoding, excerpts, cropping, borders or subtitle overlays, mirroring, resolution or
  color changes, and mild speed changes. A fingerprint match is probabilistic, not identity proof.
- Creator signatures can bind a record to a verified signing key only after a separately reviewed
  signature protocol exists.
- Trusted timestamps can provide externally witnessed time evidence only after a separately
  reviewed trusted-time profile exists.
- Publication observations record what an authorized collector observed at a platform location;
  they do not prove that the account was entitled to publish the material.
- Forensic watermark detections and C2PA assertions are corroborating soft-binding signals. They
  can be absent, damaged, removed, forged outside their trust model, or inconsistent with other
  evidence.

Multiple independent signals may corroborate a case, but no single signal automatically proves
authorship, ownership, authorization, originality, or infringement.

## Staged product roadmap

### RP-1 Rights Record

Record an original video, source or project assets, final exports, exact SHA-256 digests, media
metadata, creation events, and user-supplied licensing metadata in a portable evidence package.
Protocol 0.2.0 can provide internal integrity for such user-supplied files, but it cannot verify the
claimant or establish an earliest creation time.

Entry gate:

- Existing portable workspace/package safety and no-clobber behavior remain green.
- Rights and license fields are described as claims or observations, never verified ownership.

Exit gate:

- A record can be reproduced and verified offline from preserved files.
- Reports expose the current Internal Integrity-only assurance boundary.

### RP-2 Publication Record

Bind a rights record to an authorized account/platform publication identifier, URL, observation
time, observed page metadata, and page-snapshot digest. Later reviewed creator signatures and
trusted timestamps may strengthen identity and time signals without changing what was observed.

Entry gate:

- RP-1 portable identifiers and provenance rules are stable.
- Collection is user-driven or explicitly authorized and does not bypass authentication, access
  controls, robots policy, DRM, or platform protections.

Exit gate:

- The observation can be traced to its collector, acquisition method, time source, and hashed
  preserved material.
- The report distinguishes platform metadata, collector observation, signature, and trusted time.

### RP-3 Similarity Detection

Compare a user-supplied original with a user-authorized suspected file using exact SHA-256 plus
versioned segmented visual and audio fingerprints. Produce candidate matches, aligned time ranges,
confidence details, and observed transformations rather than a legal conclusion.

Entry gate:

- RP-1 inputs are reproducibly identified and preserved.
- Algorithms, segmenting rules, thresholds, and evaluation corpora have versioned specifications.

Exit gate:

- Frozen positive and negative corpora measure false-positive and false-negative rates.
- Reports are reproducible and explain why a candidate was surfaced.
- Every candidate requires human review.

### RP-4 Resilient Binding

Add separately reviewed forensic-watermark support and the protocol-roadmap C2PA soft-binding
bridge. Watermark embedding and detection require explicit media-quality, robustness, privacy,
interoperability, and key-management review. Neither mechanism is DRM or a guarantee against
removal or copying.

Entry gate:

- RP-3 evaluation and report semantics are stable.
- C2PA work follows the separately reviewed 0.5 protocol phase; forensic watermarking has its own
  threat model and consent policy.

Exit gate:

- Robustness and quality are measured against declared transformation suites.
- Detection results state algorithm, version, confidence, key/trust context, and failure modes.

### RP-5 Monitoring and Case Operations

Optionally provide authorized platform monitoring, review queues, license and allow lists,
evidence preservation, and complaint-package export. Private official or commercial services may
operate these workflows while consuming public evidence formats and verification algorithms.

Entry gate:

- RP-1 through RP-3 evidence and review semantics are stable; RP-4 is optional corroboration.
- Each platform integration has explicit authorization, privacy, retention, and terms-of-service
  review.

Exit gate:

- Monitoring is auditable and bounded to authorized sources.
- Case exports distinguish facts, observations, similarity findings, claimant assertions, and
  human decisions.
- Automated legal declarations or takedown submission remain disabled unless a separate scheme
  explicitly authorizes them and requires human confirmation.

## Planned portable evidence objects

These are design objects for later Schema review, not production Schema definitions:

| Object                     | Purpose                                                                        | Key relationships and minimum context                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original rights record     | Preserve original/project/final materials and claimant-supplied rights context | References exact asset digests, media metadata, creation events, licenses, protocol package ID, and later optional signature/time evidence                                                |
| Publication observation    | Preserve an authorized observation of a publication                            | References an original rights record when known; records platform/account/publication identifiers, URL, observed metadata, acquisition provenance, snapshot digest, and time-source class |
| Segmented fingerprint set  | Reproducibly derive comparison features for one preserved media asset          | References the asset digest; records visual/audio algorithms, versions, segment boundaries, parameters, and feature-set digest                                                            |
| Suspect observation        | Preserve the provenance and bytes or authorized reference used for comparison  | Records acquisition authority, source context, observed metadata, exact digest, media metadata, and optional publication observation                                                      |
| Segment-match report       | Explain a comparison between original and suspected media                      | References both fingerprint sets and source digests; records thresholds, aligned time ranges, confidence, detected transformations, unmatched regions, and algorithm versions             |
| Watermark-detection result | Report a reviewed forensic-watermark test                                      | References inspected asset digest; records detector/key context, payload or identifier when safely disclosed, confidence, regions, and limitations                                        |
| Case export                | Bundle selected evidence for human or external review                          | References immutable versions of the objects above, verification results, reviewer notes/decisions, export manifest, and assurance/legal disclaimers                                      |

Relationship overview:

```text
original rights record -> original asset -> segmented fingerprint set
          |                                      |
          +-> publication observation            +-> segment-match report
                                                         ^
suspect observation -> suspect asset -> segmented fingerprint set
          |
          +-> optional publication observation / watermark-detection result

selected records + verification results + human review -> case export
```

Every object needs stable identifiers, format and algorithm versions, canonical serialization or
equivalent reproducibility rules, exact digests for referenced preserved bytes, provenance, and
clear separation between claimant assertions and independently verified observations. Detailed
fields, limits, privacy profiles, and compatibility rules require later Schema review.

## First implementable MVP

The first implementation should be local-only and user-driven:

1. Import an original video plus optional project, source, license, and final-export files.
2. Record exact hashes, bounded media metadata, provenance, and user-entered rights context.
3. Import a suspected file that the user is authorized to possess and analyze.
4. Calculate versioned segmented visual and audio fingerprints locally.
5. Show candidate matched time ranges, confidence/evidence details, and detected transformations.
6. Require an explicit human review decision without offering an infringement verdict.
7. Export a portable technical evidence package that another implementation can reproduce.

The MVP excludes web crawling, DRM or access-control bypass, account/session automation, remote
vector infrastructure, AI-model training, invisible watermark embedding, automatic platform
complaints, legal declarations, and automatic copyright/originality/ownership decisions.

## Result vocabulary

Later implementations may use stable non-legal labels such as:

- `EXACT_FILE_MATCH`
- `SEGMENT_FINGERPRINT_MATCH`
- `FORENSIC_WATERMARK_MATCH`
- `SIGNED_ORIGINAL_RECORD`
- `TRUSTED_TIME_AND_PLATFORM_RECORD`
- `HIGH_SIMILARITY`
- `REQUIRES_HUMAN_REVIEW`

They must not emit `INFRINGEMENT_CONFIRMED`, `COPYRIGHT_CONFIRMED`, `OWNERSHIP_CONFIRMED`, or an
equivalent automated adjudication. A confidence value describes the configured technical
comparison, not legal confidence.

## Evaluation and acceptance

Fingerprint evaluation must use versioned, frozen corpora with preserved expected results:

- identical files and unrelated negative controls;
- common re-encodes and resolution changes;
- excerpts and time shifts;
- crops, borders, and subtitle or overlay additions;
- mirroring and color adjustment;
- mild speed changes and audio transformations;
- combinations of declared transformations.

For each algorithm/version/threshold profile, evaluation records corpus version, precision,
recall, false-positive rate, false-negative rate, time-range alignment error, transformation
coverage, performance, and resource bounds. Acceptance thresholds must be fixed before evaluating
a release candidate. Reports identify algorithms, versions, thresholds, matched ranges,
confidence, transformations, and limitations so results can be reproduced from preserved inputs.

## Public, private, and human responsibilities

Public responsibilities:

- portable evidence formats and later reviewed Schemas;
- exact hashing, safe package handling, reference fingerprinting/matching, verification, and test
  vectors/corpora that can be used without private services;
- reproducible technical reports and explicit assurance boundaries.

Potential private official/commercial responsibilities:

- authorized platform connectors and monitoring operations;
- commercial review queues, case workflow, official attestations, billing, operational risk
  controls, and protected service configuration;
- service-side retention, access control, audit, incident response, and platform agreements.

Private services may depend on stable public interfaces; public code must never depend on private
services or private operational rules. A human reviewer owns decisions about relevance,
authorization, license context, escalation, and any legal or platform action.

## Privacy, authorization, and legal constraints

Video, audio, page snapshots, account identifiers, URLs, project files, fingerprints, reviewer
notes, and local paths may contain personal, confidential, biometric, location, or commercially
sensitive information. Future implementations require purpose limitation, data minimization,
retention/deletion controls, access logging, encryption appropriate to the deployment, and clear
export/redaction behavior. Fingerprints and digests are not anonymous.

Evidence acquisition must record provenance and authorization. It must not download or inspect
content by bypassing authentication, DRM, paywalls, access controls, platform protections, or
third-party authorization. Platform monitoring, external sharing, complaints, or legal statements
require separate authorization and human confirmation. The software provides technical evidence
management, not legal advice or adjudication.
