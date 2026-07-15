# AIGC-Proof

Open protocol and Rust reference implementation for recording an AIGC creation workflow, signing a portable proof package with a local creator key, and verifying it offline.

```text
Protocol/engine: 0.3.0
Workbench: 0.6.0
Status: AP-031 candidate implementation
Assurance: Internal Integrity + self-asserted local creator signature
```

A valid 0.3 result means the package is internally consistent and its exact canonical Manifest was signed by the embedded Ed25519 key. The display name is self-asserted. Local trust means only that the embedded fingerprint matches this installation's current operating-system-protected key.

It is not real-name verification, copyright registration, rights determination, originality certification, proof of ownership, trusted time, or official verification. Protocol 0.2 remains supported as an explicitly unsigned Internal Integrity format.

## Offline CLI workflow

```bash
aigc-proof key create --display-label "Local creator"
aigc-proof init demo-workspace --project-name "Project Name"
aigc-proof add demo-workspace input.txt --role input
aigc-proof add demo-workspace output.txt --role output
aigc-proof record demo-workspace --event-type generation --payload-file event.json
aigc-proof seal demo-workspace --output example.aigcproof --confirm-signature
aigc-proof verify example.aigcproof
aigc-proof inspect example.aigcproof --json
```

Key rotation and disable require explicit confirmation flags. The private key remains in the operating-system credential store; public export emits only deterministic `COSE_Key` bytes. The CLI is offline, uses bounded streaming I/O, never overwrites outputs, and does not upload.

For legacy compatibility testing only, `seal --legacy-unsigned-v02` creates an unsigned 0.2 package.

## Desktop workbench

Workbench 0.6.0 is an offline React/TypeScript Electron application using renderer-safe `ProofHostApi` 1.5.0, native API 1.4.0, and engine/protocol 0.3.0. Electron Main owns path authority, validated IPC, operating-system credential operations, and bounded jobs; a supervised Utility Process exclusively owns the napi-rs addon. The renderer has no Node.js, filesystem, SQLite, credential-store, or native-module access.

The one-page workflow supports a local self-asserted signer identity, explicit per-package signing confirmation, local ComfyUI v0.27.0 creation, signed sealing, offline verification, and exact image-to-package output matching. ComfyUI, Python, models, and custom nodes are not bundled or downloaded.

See [Desktop Workbench](docs/DESKTOP-WORKBENCH.md) and [Signature Profile](docs/SIGNATURE-PROFILE.md).

## Public/private boundary

This public repository owns protocol Schemas, workspace/package formats, SHA-256, RFC 8785 JCS, event chains, COSE/Ed25519 creator signatures, the defensive verifier, CLI, napi-rs bridge, and offline Workbench. It has no dependency on `aigc-proof-official`.

Official accounts, organizational key registration, revocation services, RFC 3161 trusted time, C2PA, production KMS/HSM, risk controls, billing, and publication remain separate reviewed phases.

## Build and test

Rust 1.85.0, rustfmt, and Clippy are pinned for protocol 0.3/AP-031.

```bash
cargo fmt --all --check
cargo check --workspace --all-targets --locked
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-targets --locked
cargo doc --workspace --no-deps --locked
python scripts/verify-creator-signature-vector.py
```

A compile-only check is not executable evidence. Windows and Linux execution are required for this phase, and Windows credential-store lifecycle testing is explicit.

See [CLI](docs/CLI.md), [specification](docs/AIGC-PROOF-SPEC.md), [package format](docs/PACKAGE-FORMAT.md), [assurance levels](docs/ASSURANCE-LEVELS.md), [threat model](docs/THREAT-MODEL.md), and [compatibility](docs/COMPATIBILITY.md).

## License

Apache-2.0.
