# AIGC-Proof

Open protocol and reference implementation for recording AIGC creation processes, verifying package integrity, and applying local digital signatures.

**Status:** Pre-alpha / Specification and scaffold stage.

## Core principles

- Creation records and verification must work offline without an official server.
- Protocol, schemas, and cryptographic profiles are public and reviewable.
- External input is untrusted; package processing is defensive by default.

## Open/private boundary

This repository contains the `.aigcproof` package format, JSON Schemas, core interfaces, CLI scaffold, test-vector locations, and public documentation. Official identity, signing authority, risk controls, billing, and production operations belong only in `aigc-proof-official`. The public repository must not depend on the private repository.

## Initial architecture

```text
CLI / Desktop / WASM
        ↓
proof-core
        ↓
Schema + Package + Hash + Signature + Verification
```

## Layout

`crates/` holds Rust crates, `schemas/v0.1/` holds draft JSON Schemas, `docs/` holds the public specification, and `tests/` reserves test-vector categories.

## Local build and test

```bash
cargo fmt --all --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

On Windows, use `scripts/build.ps1` and `scripts/test.ps1`; on Linux/macOS, use the matching `.sh` scripts.

## Security and legal boundary

Treat every input as untrusted. Cryptographic and archive handling are placeholders only at this stage.

> 本项目提供创作过程记录、完整性验证和数字签名能力，不自动判定作品是否原创，也不直接构成任何司法、行政或版权登记机构的权利认定。

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Before publication, replace `OWNER` in the Cargo repository URL with the actual GitHub organization or account.
