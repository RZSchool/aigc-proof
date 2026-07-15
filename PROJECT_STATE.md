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
14. Renderer-safe `ProofHostApi` 1.4.0 contract, Standalone and Mock Host adapters, opaque
    authority references, and fail-closed native API/engine/capability/limit discovery.
15. Supervised Electron Utility Process as the exclusive native-addon owner, one-running/
    sixteen-queued bounded jobs, phase progress, truthful cancellation, crash recovery without
    replay, Main-owned SQLite, and one menu-free scrollable workflow page.
16. Host-neutral `@aigc-proof/creation-core` with immutable canonical snapshots, deterministic
    creation-event mapping, strict lifecycle transitions, and a fixed core-node ComfyUI workflow.
17. Loopback-only ComfyUI v0.27.0 adapter with bounded capability discovery, WebSocket progress,
    automatic image validation/ingestion, truthful cancel/failure behavior, and no arbitrary
    workflow, command, remote endpoint, provider path, or Renderer authority.
18. SQLite schema v2 provider/session persistence and one-page creation-to-proof controls that
    seal, immediately verify, save a report, and reopen the completed portable proof after restart.
19. Workspace-scoped creation-session listing, explicit historical restore, deterministic
    cross-workspace/new-session UI reset, and collapsed manual proof tools outside the primary
    three-step journey.

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

Complete isolated one-page Workbench (AP-022, 2026-07-13): passed through Workbench 0.3.0 at
workspace-root `app/AIGC-Proof-Workbench/AIGC-Proof.exe`. `ProofHostApi` and native API 1.1.0 add
bounded jobs, phase progress, truthful queued/running cancellation states, runtime limits, and
Utility health while engine/protocol 0.2.0 and Internal Integrity assurance remain unchanged.
Electron Main now owns authority, one-running/sixteen-queued scheduling, SQLite and result
publication; a supervised Utility Process is the exclusive `proof_napi.node` owner. Utility loss
fails affected work without replay, performs only scoped temporary cleanup, and restarts through a
fresh compatible handshake. The renderer presents all eight workflow regions on one scrollable
page with no sidebar, hidden route/tab, or Electron application menu.

Frozen pnpm 11.7.0 install, Prettier, contract plus all desktop TypeScript configurations, ESLint,
6 contract tests, 54 desktop unit/component/security/process tests, clean production builds, and
a clean native rebuild passed. Development and exact packaged Electron/CDP QA passed both target
layouts, create/open, all five asset roles, event, seal/no-clobber, verify, report/no-clobber,
metadata-only inspect, malformed/tampered rejection, queue/cancel, Utility crash/no-replay/
restart/cleanup, Unicode/space paths, SQLite restart/rebuild/corruption recovery, and three clean
exits. Package-boundary QA found 409 ASAR files, zero source maps/sources/PDBs, and Utility-only
addon loading. Normal launch created a visible window, exposed no QA/CDP port, and exited with no
residual AIGC-Proof/Electron process.

Linux `x86_64-unknown-linux-gnu` passed Rust 1.85.0 locked fetch/metadata/check/Clippy, all 36
tests/doc-tests, docs, real CLI smoke and dependency tree. Native Windows
`x86_64-pc-windows-gnu` used Rust 1.85.0 plus MinGW-w64 GCC 15.2.0 in an isolated target and passed
the same gates with all 34 applicable release-profile tests (two source-symlink tests are
Unix-only), CRLF real-CLI smoke, docs/doc-tests and dependency tree. Defender blocked the debug
integration-test EXE before execution with system error 225; no exclusion or security weakening
was applied, and the same complete test set passed from the clean release profile.

The final Windows x64 artifact is 205,586,944 bytes with SHA-256
`c52a95b45c9a89455f748084117917896aba02ec69a34b2bdd0961b90d8ee125`; ASAR SHA-256 is
`b40201930a9a1480f32ffa07cdd0f4672d687275033fcfe9f744ff663277c3ff`; native addon SHA-256 is
`958650cdfac7ff42a7d1b74b3d6baa8c936f91b75c021f96debd8c2a03cf9f36`; built Host contract SHA-256
is `dcee5e87bc2823b32ab53ebcac7a84e758a89eb6ee53011b3cbfdfa8c8e03050`. Final structured
evidence and six reviewed layout screenshots are under
`app/AIGC-Proof-Workbench/acceptance-evidence-final/`.

Independent creation-to-proof Workbench (AP-024, 2026-07-14): passed through Workbench 0.4.0 at
workspace-root `app/AIGC-Proof-Workbench/AIGC-Proof.exe`. Host contract and native API 1.2.0 add
typed provider-installation and creation-session operations while the proof engine and protocol
remain unsigned Internal Integrity 0.2.0. The new reusable Node creation core is independent of
Electron, React, Standalone SQLite, and the Standalone renderer. It freezes canonical prompt/
parameter disclosure snapshots, enforces truthful draft/frozen/running/succeeded/proof-ready/
complete transitions, and maps only successful provider/job/output relationships into six ordered
proof events.

The accepted real provider was the existing user-authorized
`E:\workspace\ComfyUI_windows_portable` installation at exact ComfyUI v0.27.0, using its existing
`DreamShaper_8_pruned.safetensors` checkpoint. AIGC-Proof neither downloaded nor packaged
ComfyUI, Python, GPU runtimes, custom nodes, or model weights. The adapter used only loopback
HTTP/WebSocket, the repository-owned seven-node text-to-image graph built from six reviewed core
node classes, and automatic bounded PNG retrieval. Custom nodes were inventoried for diagnostics
but never invoked. The fixed workflow-template SHA-256 is
`623d53adee2d221ea3fd62ffa2749466e742c948d190eed7c00f39db1cba4206`; the strict snapshot-Schema
SHA-256 is `a4ceabdf7f40d166f4977da87e5820eda6e251ce3bc974571948913187e0e824`.

Final frozen install, Prettier, all TypeScript configurations, ESLint, 6 Host-contract tests,
16 creation-core snapshot/lifecycle/provider/security/consumer tests, and 57 Desktop
unit/component/security/process tests passed, including deterministic recovery of interrupted
`running`/`succeeded` sessions as retryable failures. The exact packaged EXE passed Electron/CDP
at both required layouts with no navigation/menu or clipping, then created/opened a workspace, added all
five asset roles, inspected the real provider, froze the immutable snapshot, generated a real
296.1 KB output, automatically ingested it, recorded the creation chain, sealed and immediately
verified a no-clobber proof, saved a report, restarted, reopened the complete session, reverified
the package, rejected tampering and malformed input, recovered SQLite, and exited cleanly. The
real output SHA-256 is `0597a30fc4082f5ca9770b24ae76c3102c327fcffd5ae604af1ba5282abcb401`;
the resulting creation package SHA-256 is
`508c5c53c0b0406a4fc7b8e8235e43b78ae9c92be7e2875e49880d4c480600ec`. Independent native Windows
CLI verification accepted that same package and rejected its tampered copy with
`ASSET_HASH_MISMATCH`.

Linux Rust 1.85.0 and native Windows GNU Rust 1.85.0/MinGW-w64 GCC 15.2.0 both passed formatting,
locked check, warnings-denied Clippy, all applicable CLI/core/Schema/Node-API/security tests,
documentation, and real CLI smoke workflows. Package-boundary QA found 426 files, zero source
maps, Utility-only native-addon loading, and no test generator or ComfyUI/Python/model/custom-node
redistribution. A separate normal packaged launch created a visible window, exposed no QA/CDP
port, and exited cleanly. The final EXE is 205,586,944 bytes with SHA-256
`7ef1cf7d2915ac66c870e12e0c172617f9fcd64d631da4ee5a10adb3bad78638`; ASAR SHA-256 is
`a5a76a0fcdf3d68038b70c5316ca649f738100b4a2a09c26457a903e60b3e5f4`; native-addon SHA-256 is
`4895f030045aa629e74842c8797357f67c929ff75b6df4d5be2c800551df61fd`. Final structured evidence,
cross-verification reports, and reviewed screenshots are under
`app/AIGC-Proof-Workbench/acceptance-evidence-final/`. macOS was not executed and is not claimed
as passed.

Workspace-safe creation journey (AP-027, 2026-07-15): passed through Workbench 0.5.1 at
workspace-root `app/AIGC-Proof-Workbench/AIGC-Proof.exe`. Host contract 1.4.0 makes creation
session listing workspace-scoped while native API 1.3.0 and engine/protocol 0.2.0 remain
unchanged. Main validates the current opaque workspace authority, resolves the canonical path,
filters SQLite there, expires prior cross-workspace session authority, and rejects forged,
wrong-kind, wrong-origin, substituted, expired, and cross-workspace creation references. Startup,
workspace entry, and new-session creation clear transient output/package/report/image state;
history is restored only by explicit selection. Manual asset import, custom events, and manual
sealing remain in one collapsed unnumbered advanced disclosure, while the integrated creation path
has one primary seal/verify/report action and package-only verification remains independent.

Windows Node v24.14.0/pnpm 11.7.0 passed the frozen install, Prettier, all nine TypeScript build/
check configurations, ESLint, 6 Host-contract tests, 16 creation-core tests, 66 Desktop tests, and
the production build. A temporary checksum-verified official Linux Node v22.18.0 runtime and
Corepack pnpm 11.7.0 ran the same frozen source candidate gates under Ubuntu 24.04 WSL2: 6 Host,
16 creation-core, and 67 Linux-applicable Desktop tests passed, then the temporary runtime,
dependency store, and candidate were removed. The official Node archive SHA-256 was
`c1bfeecf1d7404fa74728f9db72e697decbd8119ccc6f5a294d795756dfcfca7`.

Native Windows GNU Rust 1.85.0/MinGW-w64 GCC 15.2.0 passed formatting, locked release check,
warnings-denied all-target/all-feature Clippy, all 41 Windows-applicable tests plus doc-tests,
documentation, real CRLF PowerShell CLI smoke, metadata, and dependency tree. Linux
`x86_64-unknown-linux-gnu` Rust/Cargo 1.85.0 passed the equivalent locked/offline gates, all 44
Linux tests plus doc-tests, and the real Bash CLI smoke. No security test was skipped or weakened.

Development and exact packaged Electron/CDP QA each passed 49 automated observations, including
both target layouts, default-collapsed advanced tools plus one positive manual workflow, two
workspaces with isolated history and explicit restoration, new-session clearing, real ComfyUI
v0.27.0 generation through the existing `DreamShaper_8_pruned.safetensors` checkpoint, automatic
proof completion, visible output, exact no-clobber export, `verified_output_match`, changed-image
`not_in_package`, input-only `matched_non_output`, tampered/malformed `package_invalid`, package-
only verification, Utility recovery, SQLite restart/rebuild/corruption recovery, independent CLI
verification, and clean exits. The real generated output SHA-256 is
`86c69dbb5ef86f2c22d819f8e781ee8b9e7780cf888ba2512766f40d1a753ba4`; the creation-package
SHA-256 is `ab3ab8aa5c41c39f4eed83728f06ec6fd9bee57d6b5d3242f667885c15764b4b`.

Package-boundary QA found 428 packaged files, zero source maps/sources/PDBs, Utility-only addon
loading, and coherent 0.5.1/1.4.0/1.3.0/0.2.0 versions. A separate normal launch created a visible
window with QA/CDP ports disabled and exited cleanly with no residual process. The frozen Windows
x64 EXE is 205,586,944 bytes with SHA-256
`0026c46189a146101d5f0e4c670de9724292b2cf686bb0bf9ee7882ced1d2c21`; ASAR SHA-256 is
`555b0452a6d674c6e3b49d976a8dbf3931272c633311ad77dce601ca2a388c89`; native-addon SHA-256 is
`1965863929360083d9593ff060e5aa13eebc5dd084f5a94a6734d4dbc06f9461`; built Host-contract
SHA-256 is `8f0971ee8f42c25db0133c43d1f314293ff354896f4c8cb8efef06282efdbf29`.
Final structured evidence and reviewed screenshots are under
`app/AIGC-Proof-Workbench/acceptance-evidence-final/`. macOS was not executed and is not claimed.

Not implemented:

- Creator identity verification
- Digital signature or COSE_Sign1
- Trusted timestamp, RFC 3161, or C2PA
- Originality or copyright evaluation
- Official verification, accounts, network APIs, official-service databases, WASM, or upload

Ready for review does not expand the Internal Integrity-only assurance boundary or imply a
release, signature, creator identity, trusted timestamp, originality judgment, or official
verification.
