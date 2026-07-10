# Development

rust-toolchain.toml pins Rust 1.85.0 with rustfmt and Clippy. Restore repository context using AGENTS.md and the required Git commands before every task.

Required validation order:

~~~bash
cargo fmt --all --check
cargo check --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo doc --workspace --no-deps
scripts/smoke-test.sh
~~~

Run cargo metadata --format-version 1 and cargo tree when the toolchain is available. Retain the generated Cargo.lock. cargo audit is optional only when already installed.

The smoke test executes the real init/add/record/seal/verify/inspect binary flow and parses the persisted JSON report. Static review or cargo check alone is not a program test.

If rustup is missing, install it only from the official Rust project, then install the pinned toolchain:

~~~bash
rustup toolchain install 1.85.0 --profile default --component rustfmt clippy
~~~

Never claim tests passed when the toolchain or executable path did not run.
