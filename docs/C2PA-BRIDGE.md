# C2PA 2.2 Bridge Profile

## Boundary

AIGC-Proof protocol 0.5 introduced the C2PA 2.2 Content Credentials bridge and protocol 1.0 retains it unchanged without treating C2PA as an AIGC-Proof signature or identity attestation. The bridge accepts claim v2 for JPEG, PNG, and WebP, plus claim v1 for read-only compatibility. A manifest may be embedded or supplied as a lowercase local `.c2pa` sidecar selected explicitly by the user.

The bridge does not support MP4, PDF, claim versions later than 2, remote-manifest retrieval, soft-binding lookup, OCSP fetching, or automatic sidecar discovery. It does not copy arbitrary assertion explanations, certificate subjects, or ingredient text into trusted UI or portable observations.

## Dependency and execution profile

The product pins Rust `c2pa` 0.89.3 with `default-features = false` and only `file_io` plus `rust_native_crypto`. This security-maintained patch line resolves the `quick-xml` denial-of-service advisories affecting the AP-033 runtime dependency; the frozen 0.85.0 SDK corpus remains a read-compatibility input. Product verification configures an empty allowed-host list, disables remote-manifest and OCSP fetches, and runs in the supervised Utility Process. Electron Renderer and Main contain no C2PA parser, PKIX implementation, trust store, socket, native addon, or raw path authority.

The locked advisory gate uses the frozen RustSec database and fails on warnings except for two reviewed entries: RUSTSEC-2023-0071 has no fixed `rsa` release and concerns private-key timing, while this bridge never creates, imports, or uses an RSA private key; RUSTSEC-2024-0370 is an unmaintained build-time procedural macro and is absent from the packaged runtime surface. Neither exception suppresses a reachable parser, memory-safety, network, signature-verification, or packaged-runtime vulnerability. The complete lock graph must otherwise be clean, and every third-party package must declare a license without AGPL, SSPL, BUSL, or Commons Clause terms.

Inputs are regular files selected through Main-owned dialogs. The adapter limits an image to 128 MiB, a manifest store to 32 MiB, a trust profile to 4 MiB, 64 manifests, 1,024 assertions, 256 ingredients, bounded labels/certificates/status codes, a 32 MiB SDK backing-store threshold, and 30 seconds of processing. The SDK owns JUMBF, COSE, certificate, media-binding, and claim parsing; AIGC-Proof does not implement a parallel parser.

## Optional portable trust profile

`aigc-proof.c2pa-trust-profile.v1` contains two separate snapshots:

- signer roots, allowed EKUs, source label, and validity interval;
- C2PA timestamp roots, allowed EKUs, source label, and validity interval.

Strict JSON is validated before use, canonicalized with RFC 8785 JCS, and SHA-256 hashed as a whole and per snapshot. Profiles are optional explicit session inputs and are not persisted in SQLite or bundled as product roots. With no profile, inspection still performs bounded offline media binding, signature, claim, and structure validation, explicitly disables signer/timestamp trust verification, forces both trust states to `not_evaluated`, and reports a cryptographically valid result as `valid_untrusted`; ambient roots cannot upgrade it. C2PA signer trust and C2PA timestamp trust remain separate from the local creator Ed25519 key, the RFC 3161 snapshot, and official-identity issuer trust.

Profile validation also rejects purpose confusion before media evaluation: the signer snapshot must
allow a C2PA/document-signing EKU and the timestamp snapshot must allow `id-kp-timeStamping`.

## Observation

`c2pa_observation` is an ordinary signed event in a protocol 0.5 or 1.0 workspace. It records:

- profile identifier;
- workspace asset ID and exact asset SHA-256;
- exact manifest-store byte SHA-256;
- `embedded` or `sidecar` source mode;
- claim version and bounded active-manifest label;
- signer and timestamp trust-snapshot SHA-256 values;
- normalized validation, signer-trust, and timestamp-trust states;
- sorted, deduplicated, bounded SDK status codes.

Observation creation, unlike read-only inspection, requires an explicit trust profile because the protocol event requires both snapshot digests. It first reloads the workspace asset and requires its current SHA-256 to equal the recorded workspace digest. A sidecar does not gain authority over a different image. The observation is then covered by the event hash chain and the creator-signed package Manifest.

`observed_trusted` means the recorded image/manifest relationship validated and the imported C2PA signer snapshot trusted the signing certificate. `observed_valid_untrusted` preserves cryptographic validity without asserting trust. C2PA timestamp trust is shown independently and is `not_evaluated` when the manifest has no timestamp result.

None of these states proves factual truth, a person's identity, authorship, originality, ownership, copyright, permission, license scope, or non-infringement.

## Optional host signing callback

The public Rust core exposes an optional typed callback for a future conforming Host. The callback receives only bounded SDK to-be-signed bytes, their SHA-256, and the selected algorithm; it returns a bounded signature and an X.509 chain. The SDK creates a claim-v2 `c2pa.created` assertion with the `trainedAlgorithmicMedia` digital-source type and writes to a new output without overwrite.

Standalone Workbench 1.1.0 does not expose this writer, private-key import, certificate enrollment, TSA URL, or production trust root. Tests use only fixed public test certificates and an ephemeral in-process private key. Media must be C2PA-signed before it is ingested or sealed as an AIGC-Proof output.

## CLI

```text
aigc-proof c2pa profile <trust-profile.json>
aigc-proof c2pa inspect --asset <image> [--sidecar <manifest.c2pa>] [--trust-profile <profile.json>]
aigc-proof c2pa observe --workspace <dir> --asset-id <uuid> [--sidecar <manifest.c2pa>] --trust-profile <profile.json>
```

All three operations are local. `inspect` never records an event and does not require trust material; `observe` requires a profile and records only after the exact workspace digest is revalidated.
