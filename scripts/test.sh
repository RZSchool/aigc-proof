#!/usr/bin/env bash
set -euo pipefail

cargo fmt --all --check
cargo check --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo doc --workspace --no-deps
"$(dirname "$0")/smoke-test.sh"
