# Development

## Purpose

Provide the Phase 0 local validation baseline.

## Current decision

Use Rust 1.85 or newer compatible with the workspace MSRV. Run:

```bash
cargo fmt --all --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## Not decided

Release automation, dependency policy, and contributor workflow are pending.

## Next

Add deterministic test vectors and contributor guidance.
