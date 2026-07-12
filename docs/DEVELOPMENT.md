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
CI uses Rust 1.85.0 explicitly, consumes Cargo.lock with `--locked`, and covers Ubuntu,
Windows, and macOS. The shell smoke path runs on Ubuntu and macOS; `scripts/smoke-test.ps1`
runs the equivalent native PowerShell path on Windows. `scripts/test.ps1` runs the complete
locked Windows check sequence and then invokes that smoke test. The real binary integration
tests run on all three platforms.

The Electron workbench under `apps/desktop` uses the pinned Node/pnpm dependency graph. Run its
checks from that directory:

~~~bash
pnpm install --frozen-lockfile --config.block-exotic-subdeps=false
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
~~~

`pnpm qa:dev` and `pnpm qa:packaged` drive the actual Electron renderer through the typed preload
over a loopback CDP port enabled only by the dedicated QA flag. `pnpm qa:package-boundary` validates
the packaged ASAR and native addon. On native Windows, `scripts/package-workbench.ps1` builds the
addon and directly launchable folder, while `scripts/verify-packaged-workbench.ps1` checks normal
launch, disabled CDP, and clean exit. Passing source tests alone is not packaged acceptance.

The smoke tests execute the real init/add/record/seal/verify/inspect binary flow and parse the
persisted JSON report. The PowerShell path also supplies CRLF input and event JSON. Static review
or cargo check alone is not a program test.

If rustup is missing, install it only from the official Rust project, then install the pinned toolchain:

~~~bash
rustup toolchain install 1.85.0 --profile default --component rustfmt clippy
~~~

Never claim tests passed when the toolchain or executable path did not run.
