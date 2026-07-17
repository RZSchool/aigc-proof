# Development

rust-toolchain.toml pins Rust 1.88.0 with rustfmt and Clippy. Restore repository context using AGENTS.md and the required Git commands before every task.

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
CI uses Rust 1.88.0 explicitly, consumes Cargo.lock with `--locked`, and covers Ubuntu,
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

`@aigc-proof/host-contracts` and `@aigc-proof/creation-core` are independent pnpm workspace
packages. The root `typecheck`, `test`, and `build` commands include their strict DTO/Schema,
SemVer, capability, lifecycle, snapshot, provider, evidence mapping, limit, job,
opaque-reference, and consumer tests. It must remain importable without Electron, React, Node
globals, filesystem, or native loading. Type checking and production builds include the renderer,
Main, preload, Utility, QA, and contract configurations.

`pnpm qa:dev` and `pnpm qa:packaged` drive the actual Electron renderer through the typed preload
over a loopback CDP port enabled only by the dedicated QA flag. `pnpm qa:package-boundary` validates
the packaged ASAR and native addon. On native Windows, `scripts/package-workbench.ps1` builds the
addon and directly launchable folder, while `scripts/verify-packaged-workbench.ps1` checks normal
launch, disabled CDP, and clean exit. Passing source tests alone is not packaged acceptance.
Workbench startup validates the supervised Utility's native API 2.1.0 / engine 1.0.0 / protocol
0.2.0, 0.3.0, 0.4.0, 0.5.0, and 1.0.0 discovery, execution facts, and limits before proof IPC registration. Main is the authority,
job scheduler, SQLite owner, and result publisher; only Utility source may load
`proof_napi.node`. The QA-only selection manifest and crash command are accepted only together
with the explicit QA/CDP flag; normal launch cannot use either surface.

AP-025 packaged acceptance additionally requires `AIGC_PROOF_COMFYUI_DIR` (or the documented
native-Windows default) to point to the user-authorized ComfyUI v0.27.0 portable root. The CDP
harness runs a real fixed-template generation, checks automatic output ingestion and creation
events, displays and exports the exact output, independently matches the exported image to the
verified package output, rejects modified/non-output/invalid-package cases, seals/verifies/saves,
restarts, exports and matches again, and runs the native CLI against the same package. The
deterministic test provider covers reproducible failure/lifecycle vectors but cannot
replace the real-provider acceptance.

AP-032 acceptance additionally starts an ephemeral localhost HTTPS TSA with a runtime-generated
test CA and test-only signer. It imports a portable snapshot, inspects the exact request with
OpenSSL, attaches and verifies the response offline, compares protected entry bytes, rejects
redirect/media/size/timeout/substitution failures, exercises cancellation, and confirms that
failed timestamp acquisition never invalidates the creator signature. Test keys and responses
remain under the scheme evidence directory and never enter Git or the packaged app.

AP-033 acceptance additionally pins the official C2PA SDK, conformance, attacks, and c2patool
reference inputs under `test-results/AP-033`. Set `AIGC_PROOF_C2PA_SDK_FIXTURES` for the Rust
bridge corpus tests and `AIGC_PROOF_C2PA_CORPUS_DIR` for desktop QA. The harness inspects real
claim-v2 JPEG/PNG/WebP embedded and no-embed sidecar fixtures, records a workspace digest-bound
observation, and rejects remote references, unsupported media, soft binding, tampering, and
malformed/limit cases. Test certificates and private keys remain evidence-only and are never
packaged.

The smoke tests execute the real init/add/record/seal/verify/inspect binary flow and parse the
persisted JSON report. The PowerShell path also supplies CRLF input and event JSON. Static review
or cargo check alone is not a program test.

If rustup is missing, install it only from the official Rust project, then install the pinned toolchain:

~~~bash
rustup toolchain install 1.88.0 --profile default --component rustfmt clippy
~~~

Never claim tests passed when the toolchain or executable path did not run.
