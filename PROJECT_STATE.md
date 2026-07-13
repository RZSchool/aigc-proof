Project: AIGC-Proof-Skill Open Source
Stage: Phase 1 - v0.2 Verifiable Package MVP WIP
Status: Ready for review

Implemented in source:
1. Local proof workspace init, asset add, event record, seal, verify, and inspect flows.
2. Streaming SHA-256 asset hashing.
3. RFC 8785 JCS canonical JSON.
4. Strict canonical UTC RFC 3339 timestamps.
5. Creation event hash chain starting at sequence 1.
6. Standard ZIP with ZIP64 support when required.
7. Defensive, non-extracting ZIP validation with centralized limits.
8. JSON Schema checks plus Rust semantic and cross-platform safety checks.
9. Multi-stage JSON verification reports with explicit assurance limits.
10. Dynamic tamper and malicious-package test sources.
11. React + TypeScript Electron workbench with typed preload/allowlisted IPC and offline security
    policy.
12. Async napi-rs Node-API bridge over `proof-core` / `proof-schema` and disposable bundled-SQLite
    workbench state.
13. Development and packaged Electron/CDP QA with explicit QA-only debugging ports.
14. Renderer-safe `ProofHostApi` 1.0.0 contract, Standalone and Mock Host adapters, opaque
    authority references, and fail-closed native API/engine/capability discovery.

Verification status:
- Rust toolchain: Rust 1.85.0, rustfmt, and Clippy installed and confirmed
- `cargo fmt --all --check`: passed
- `cargo fetch --locked`: passed; all Cargo.lock packages are available
- `cargo metadata --format-version 1`: passed
- `cargo metadata --locked --format-version 1`: passed
- `cargo check --workspace --locked`: passed
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: passed
- `cargo test --workspace --locked`: passed (36 tests: 2 CLI, 14 package/security,
  6 proof-core unit, 10 proof-schema unit, 1 committed-vector test, 3 proof-napi/SQLite/discovery
  tests;
  doc-tests passed)
- `cargo doc --workspace --no-deps --locked`: passed
- `scripts/smoke-test.sh`: passed with real init/add input/add output/record/seal/
  verify/report/inspect text/inspect JSON execution
- Real CLI negative acceptance: passed for asset, Manifest, and event-chain tampering,
  persisted invalid JSON reporting, and a traversal ZIP
- `cargo tree --locked`: passed; direct dependency versions match Cargo.toml and Cargo.lock holds
  the Rust-1.85-compatible idna/ICU4X transitive line

Overall verification result: all required fixed-toolchain checks and real executable paths
passed again on 2026-07-13. The v0.2 candidate is Ready for review.

Native Windows follow-up (AP-002, 2026-07-11): passed on GitHub Actions run 29144222205. The
`windows-latest` Windows Server 2025 runner used Rust 1.85.0 with the
`x86_64-pc-windows-msvc` host. Fmt, locked check, locked all-target/all-feature Clippy with
warnings denied, 31 Windows-applicable tests, locked documentation, and the native PowerShell
smoke path passed. The tests included real positive and negative CLI execution, tampering,
malicious ZIPs, Windows path/case behavior, no-clobber writes, CRLF JSON, and temporary-file
cleanup; two Unix-only symlink tests are intentionally gated by `cfg(unix)`. The smoke path
executed init/add/record/seal/verify/persisted report/inspect using real Windows executables.
Ubuntu and macOS jobs passed in the same matrix run. This clean MSVC result supersedes the local
Windows GNU Defender environment blocker without weakening or excluding any security control.

Desktop architecture alignment (AP-012, 2026-07-12): passed through the packaged Windows x64
artifact at workspace-root `app/AIGC-Proof-Workbench/AIGC-Proof.exe`. Workbench 0.1.0 uses the
unchanged 0.2.0 protocol through a typed context-isolated preload, allowlisted validated IPC, an
async napi-rs Node-API adapter, and bundled SQLite application state. Electron/CDP drove the exact
packaged executable through create/reopen workspace, add input/output, record, seal/no-clobber,
valid verify, report/no-clobber, metadata-only inspect, SQLite restart/rebuild, Unicode/space paths,
clean exit, and tamper rejection. Package-boundary QA found 642 ASAR files, zero source maps, the
offline CSP and production window security defaults; normal PowerShell launch exposed neither QA
port and exited cleanly. The executable is 205,586,944 bytes with SHA-256
`0b4cb1a98abbf33fc2897a9e2eafc2ae2da4439c12159bec15d911bb3e1fc1c1`; the native addon SHA-256 is
`c8d75c5cc796cdbb9567fbe0b29a8659bc86c6129d70c73b293cf5da8f21d05f`. Final evidence is under
the AP-012 execution record; this 0.1.0 candidate was superseded by Workbench 0.1.1 in AP-016. The
validated Win32 tactical frontend was then removed from the Cargo workspace and current source/QA
path; its historical local artifact is retained only under workspace-root `app/legacy/`.

Create-workspace UX correction (AP-016, 2026-07-12): passed through Workbench 0.1.1 at
workspace-root `app/AIGC-Proof-Workbench/AIGC-Proof.exe`. Creation now selects an existing parent,
accepts one validated portable new-folder component, and previews a Main-resolved target; opening
an existing workspace is a separate typed flow. Main rejects missing parents, separators,
dot/parent, controls, Windows-forbidden/reserved names, trailing dot/space, excessive length, and
existing targets before Rust, while the unchanged core no-overwrite check remains defense in
depth. Frozen Node install, formatting, four TypeScript checks, ESLint, 26 unit/component/security
tests, production build, napi-rs build, development CDP QA, and packaged CDP QA passed. The exact
package began with the reported existing-target scenario, preserved its marker file, displayed
Chinese safe guidance, then created and separately opened a Unicode/space-path workspace, added
input/output, recorded, sealed/no-clobber, verified, saved report/no-clobber, inspected, persisted
and rebuilt SQLite recents, rejected tampering, and exited cleanly twice. Package-boundary QA found
644 ASAR files and zero source maps; normal launch exposed no QA ports and exited cleanly. The EXE
is 205,586,944 bytes with SHA-256
`6f8317133e9cfd3df276ff3c08567a039e9e9baab1f11183c8f375d0b1b629ca`; ASAR SHA-256 is
`9a6fffd734b9301a3b367cb93adcb6a6d4f0ea709dac99f0b48053b6b71b1834`; native addon SHA-256 is
`c8d75c5cc796cdbb9567fbe0b29a8659bc86c6129d70c73b293cf5da8f21d05f`. Final evidence is under
`app/AIGC-Proof-Workbench/acceptance-evidence-final/`. Linux Rust 1.85.0 fmt, locked check, Clippy,
all 35 tests, docs, real CLI smoke, metadata, and dependency tree remained green.

Versioned Host contract (AP-020, 2026-07-13): passed through Workbench 0.2.0 at workspace-root
`app/AIGC-Proof-Workbench/AIGC-Proof.exe`. `@aigc-proof/host-contracts` 1.0.0 is the renderer-safe
source of DTOs, strict Schemas, versions, capabilities, errors, and `ProofHostApi`; the renderer
uses its Standalone adapter and a deterministic Mock Host is available for consumer/component
tests. Main now validates `proof_napi.node` discovery before registering proof-operation IPC. The
accepted addon reports native API 1.0.0, engine 0.2.0, protocol 0.2.0, nine implemented
capabilities, async napi-rs tasks, and the explicit absence of Utility Process isolation, progress
streaming, and safe cancellation. Expiring typed opaque references separate display paths from
authority and are revalidated by Main at operation time. This does not implement AIGCStudio,
asset-token, task/staging, Utility Process, signature/time/C2PA, Rights Protection, service,
network, upload, or telemetry integration.

Frozen pnpm install, format, five TypeScript configurations, ESLint, 6 contract tests, 40 desktop
unit/component/security tests, production build, and native rebuild passed. Development and exact
packaged Electron/CDP QA passed create/open, all five asset roles, event, seal/no-clobber, valid
verify, report/no-clobber, metadata-only inspect, malformed/tampered rejection, exact diagnostics,
Unicode/space paths, SQLite restart/rebuild, and two clean exits. Package-boundary QA found 660
ASAR files, zero source maps, the offline CSP, production window security defaults, and the real
packaged addon discovery. A normal launch exposed no QA/CDP ports and exited cleanly. Windows x64
acceptance ran on Microsoft Windows NT 10.0.26200.0 with Rust 1.85.0 GNU, Node v24.14.0, and pnpm
11.7.0. The EXE is 205,586,944 bytes with SHA-256
`1c75428c7655e3c0c8a4c5f86525e6f00e43e50d6def4981a863c7d76937d379`; ASAR SHA-256 is
`c0d57d83be431c9c1ae8915019390a246e2bccd29e8685f3ea8eff8c00b49e4f`; native addon SHA-256 is
`a60c39611d37a4a210925b9680b6f78f439cf57b5006fa7b915d4acf0af38aac`. Structured evidence and
screenshots are under `app/AIGC-Proof-Workbench/acceptance-evidence-final/`. Linux
x86_64-unknown-linux-gnu passed Rust 1.85.0 fmt, locked check, locked Clippy, all 36 tests,
docs/doc-tests, and real CLI smoke. Native Windows GNU passed the same gates with all 34
Windows-applicable tests; the two source-symlink tests remain Unix-only. Locked metadata and the
dependency tree also passed.

Not implemented:
- Creator identity verification
- Digital signature or COSE_Sign1
- Trusted timestamp, RFC 3161, or C2PA
- Originality or copyright evaluation
- Official verification, accounts, network APIs, official-service databases, WASM, or upload

Ready for review does not expand the Internal Integrity-only assurance boundary or imply a
release, signature, creator identity, trusted timestamp, originality judgment, or official
verification.
