# C2PA 2.2 Bridge Profile

## Boundary

AIGC-Proof protocol 0.5 reads C2PA 2.2 Content Credentials without treating them as AIGC-Proof signatures or identity attestations. The bridge accepts claim v2 for JPEG, PNG, and WebP, plus claim v1 for read-only compatibility. A manifest may be embedded or supplied as a lowercase local `.c2pa` sidecar selected explicitly by the user.

The bridge does not support MP4, PDF, claim versions later than 2, remote-manifest retrieval, soft-binding lookup, OCSP fetching, or automatic sidecar discovery. It does not copy arbitrary assertion explanations, certificate subjects, or ingredient text into trusted UI or portable observations.

## Dependency and execution profile

The product pins Rust `c2pa` 0.85.0 with `default-features = false` and only `file_io` plus `rust_native_crypto`. Product verification configures an empty allowed-host list, disables remote-manifest and OCSP fetches, and runs in the supervised Utility Process. Electron Renderer and Main contain no C2PA parser, PKIX implementation, trust store, socket, native addon, or raw path authority.

Inputs are regular files selected through Main-owned dialogs. The adapter limits an image to 128 MiB, a manifest store to 32 MiB, a trust profile to 4 MiB, 64 manifests, 1,024 assertions, 256 ingredients, bounded labels/certificates/status codes, a 32 MiB SDK backing-store threshold, and 30 seconds of processing. The SDK owns JUMBF, COSE, certificate, media-binding, and claim parsing; AIGC-Proof does not implement a parallel parser.

## Portable trust profile

`aigc-proof.c2pa-trust-profile.v1` contains two separate snapshots:

- signer roots, allowed EKUs, source label, and validity interval;
- C2PA timestamp roots, allowed EKUs, source label, and validity interval.

Strict JSON is validated before use, canonicalized with RFC 8785 JCS, and SHA-256 hashed as a whole and per snapshot. Profiles are explicit session inputs and are not persisted in SQLite or bundled as product roots. C2PA signer trust and C2PA timestamp trust remain separate from the local creator Ed25519 key, the RFC 3161 snapshot, and any later official-identity root.

## Observation

`c2pa_observation` is an ordinary signed event in a protocol 0.5 workspace. It records:

- profile identifier;
- workspace asset ID and exact asset SHA-256;
- exact manifest-store byte SHA-256;
- `embedded` or `sidecar` source mode;
- claim version and bounded active-manifest label;
- signer and timestamp trust-snapshot SHA-256 values;
- normalized validation, signer-trust, and timestamp-trust states;
- sorted, deduplicated, bounded SDK status codes.

Observation creation first reloads the workspace asset and requires its current SHA-256 to equal the recorded workspace digest. A sidecar does not gain authority over a different image. The observation is then covered by the event hash chain and the creator-signed package Manifest.

`observed_trusted` means the recorded image/manifest relationship validated and the imported C2PA signer snapshot trusted the signing certificate. `observed_valid_untrusted` preserves cryptographic validity without asserting trust. C2PA timestamp trust is shown independently and is `not_evaluated` when the manifest has no timestamp result.

None of these states proves factual truth, a person's identity, authorship, originality, ownership, copyright, permission, license scope, or non-infringement.

## Optional host signing callback

The public Rust core exposes an optional typed callback for a future conforming Host. The callback receives only bounded SDK to-be-signed bytes, their SHA-256, and the selected algorithm; it returns a bounded signature and an X.509 chain. The SDK creates a claim-v2 `c2pa.created` assertion with the `trainedAlgorithmicMedia` digital-source type and writes to a new output without overwrite.

Standalone Workbench 0.8.0 does not expose this writer, private-key import, certificate enrollment, TSA URL, or production trust root. Tests use only fixed public test certificates and an ephemeral in-process private key. Media must be C2PA-signed before it is ingested or sealed as an AIGC-Proof output.

## CLI

```text
aigc-proof c2pa profile <trust-profile.json>
aigc-proof c2pa inspect --asset <image> [--sidecar <manifest.c2pa>] --trust-profile <profile.json>
aigc-proof c2pa observe --workspace <dir> --asset-id <uuid> [--sidecar <manifest.c2pa>] --trust-profile <profile.json>
```

All three operations are local. `inspect` never records an event; `observe` records only after the exact workspace digest is revalidated.
