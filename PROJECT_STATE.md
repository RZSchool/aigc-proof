Project: AIGC-Proof-Skill Open Source
Stage: Stable Protocol and Workbench 1.1 Candidate
Status: AP-036 implementation, validation and candidate freeze complete

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
14. Renderer-safe `ProofHostApi` 2.1.0 contract, Standalone and Mock Host adapters, opaque
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
20. Protocol 0.3/0.4 Ed25519 creator signatures with deterministic COSE_Key/COSE_Sign1 encoding,
    offline verification, OS-credential-store custody, key create/rotate/disable lifecycle, a
    self-asserted display label and full fingerprint, and separate integrity/signature/local-trust
    assurance results; protocol 0.2 remains valid unsigned Internal Integrity.
21. Protocol 0.4 RFC 3161 trusted time over the exact tagged creator COSE bytes, with a
    creator-signed request plan, 128-bit nonce, explicit portable TSA trust snapshot, strict
    certificate/profile/revocation checks, Main-owned opt-in HTTPS acquisition, and offline
    verification that remains separate from creator identity and content-origin claims.
22. Protocol 0.5 bounded offline C2PA 2.2 observation bridge for JPEG/PNG/WebP embedded manifests
    and explicitly selected local sidecars, with claim v1 read compatibility, claim v2 current
    behavior, separate signer/TSA trust snapshots, normalized reports, and remote/soft-binding/
    unsupported-media refusal.
23. Protocol 1.0 stable compatibility, optional independent trusted time/C2PA/official identity
    assurance, strict public AP-034 attestation/status verification, rollback/freshness policy,
    Host/native API 2.1 and Workbench 1.1 offline identity import without private-service runtime
    dependency.
24. Workbench 1.1 and Host/native API 2.1 keep RFC 3161 and C2PA in one collapsed optional
    advanced area, allow bounded trustless offline C2PA inspection with explicit
    `valid_untrusted`/`not_evaluated` states, and continue to require an explicit reviewed trust
    snapshot before a C2PA observation can enter protocol evidence.

Historical initial verification status (superseded by the versioned records below):

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

Signed creator proof (AP-031, 2026-07-16): passed through Workbench 0.6.0 at workspace-root
`app/AIGC-Proof-Workbench/AIGC-Proof.exe`. Protocol/engine/workspace 0.3.0 bind the exact RFC 8785
Manifest bytes to a tagged detached-payload COSE_Sign1 Ed25519 signature. The deterministic
COSE_Key SHA-256 is the full public fingerprint. The private key remains in the current user's OS
credential store and is never exposed through Node-API, IPC, Renderer, SQLite, packages, reports,
logs or fixtures. The displayed creator label is explicitly self-asserted: signature validity and
local trust do not prove real identity, originality, copyright, ownership or authorization.

The final lock contains the reviewed exact `coset 0.4.2`, `ed25519-dalek 2.2.0` and `keyring
3.6.3` dependencies. Native Windows `x86_64-pc-windows-msvc` Rust 1.85.0 passed locked formatting,
all-target checks, warnings-denied Clippy, 51 workspace tests, the separately enabled real OS
credential create/read/use/rotate/disable/cleanup test, documentation, metadata/tree and real CLI
status. Actual Ubuntu `x86_64-unknown-linux-gnu` Rust 1.85.0 passed the equivalent gates with 54
workspace tests and the explicit persistent-store-unavailable fail-closed path. An independent
Python-stdlib CBOR plus OpenSSL 3.2.1 verifier accepted the frozen creator vector and rejected a
substituted Manifest. Cargo.lock SHA-256 is
`662722ea61261270e77994cd20ccb49682c3881196a83b331a455bfa617b5589`.

Windows Node v24.14.0/pnpm 11.7.0 passed Prettier, all TypeScript checks, ESLint, 7 Host-contract
tests, 16 creation-core tests, 67 Desktop tests and production builds. Development and exact
packaged Electron/CDP QA each passed the complete real workflow. The final packaged run recorded
55 passing assertions, including OS-store key creation, full fingerprint display/copy, explicit
signature confirmation, real ComfyUI v0.27.0 output ingestion, signed seal/verify/report, key
rotation, historical valid-untrusted verification, signature tamper rejection, key disable with
continued cryptographic verification, workspace reset/restart/recovery and clean exits. The real
output SHA-256 is `e454d7f4db23f89f27709e5f176d1bf37e11a0b7d34887e440849d55edbe3fdb`;
the creation package SHA-256 is
`b3ffaf30f3445c4141cb2bdb4b0981134683cc8f391a970989bef792db4224ba`.

Package-boundary QA found 428 packaged files, zero source maps/sources/PDBs, Utility-only addon
loading and coherent 0.6.0/1.5.0/1.4.0/0.3.0 versions. Textual private-material fields and
test-only private-key markers were absent from the ASAR and QA evidence, and the dedicated QA
credential namespace was cleaned. A separate normal launch created a visible window with QA/CDP
ports disabled and exited cleanly. The frozen Windows x64 EXE is 205,586,944 bytes with SHA-256
`4edfdd00334398aabe0a3bc2ce5a043feb61fabf81ad0625956f84fa2f1d1512`; ASAR SHA-256 is
`7bf2fe5bf071a7b5a68080acf71365049de9192f142d94121b13442275d57ad3`; native-addon SHA-256 is
`e57541cb407878a526425e005b33d0183f21f40af17acc8d62754d3331222e74`. Final structured
evidence and screenshots are under `test-results/AP-031/desktop-packaged/`. macOS was not
executed and is not claimed.

Trusted time (AP-032, 2026-07-16): passed through Workbench 0.7.0 at workspace-root
`app/AIGC-Proof-Workbench/AIGC-Proof.exe`. Protocol/engine/workspace 0.4.0 signs an RFC 3161
request plan into the Manifest before creator signing, binds a SHA-256 imprint of the exact tagged
creator COSE bytes and a 128-bit nonce, and optionally appends one bounded timestamp response.
Verification remains offline and produces `valid_trusted` only against the exact imported portable
TSA snapshot after nonce, imprint, policy, ESS binding, critical timestamping EKU, ECDSA P-256/P-384
signature, explicit chain, validity-at-`genTime`, configured time bounds and available revocation
evidence all pass. Missing or rejected timestamp evidence does not weaken or relabel the separately
valid creator signature.

The CLI performs request generation and verified no-clobber attachment without network access.
Workbench acquisition is an explicit per-request action through the only non-loopback product
transport in Electron Main: HTTPS only, DNS-address scope enforcement, redirect rejection, bounded
MIME/body/time, cancellation and no credential forwarding. The Renderer retains no Node.js,
filesystem, native-addon, SQLite, credential-store or generic-network authority. Runtime OpenSSL
TSA tests covered valid issuance plus nonce, imprint, policy, signer, chain, EKU, ESS, time,
revocation, malformed/oversize, replay and no-clobber negatives; packaged QA also stopped the TSA
before final verification to prove the accepted workflow was offline.

Native Windows `x86_64-pc-windows-msvc` and actual Ubuntu 24.04 WSL2
`x86_64-unknown-linux-gnu` both used isolated Rust 1.85.0 toolchains and passed formatting, locked
all-target checks, warnings-denied all-target/all-feature Clippy, every applicable workspace test,
documentation/doc-tests and real offline CLI smoke workflows. Windows passed 51 applicable Rust
tests and Ubuntu passed 54, including the additional Unix symlink cases. Windows Node v24.14.0 and
pnpm 11.7.0 passed Prettier, all TypeScript checks, ESLint, 7 Host-contract tests, 16 creation-core
tests, 73 Desktop tests and production builds. Development and exact packaged Electron/CDP QA
passed the real creator-key, ComfyUI v0.27.0 generation, signed seal, RFC 3161 acquisition,
attachment, service-stopped offline verification, negative timestamp, restart/recovery and clean
exit workflow.

The reviewed dependency graph uses exact `x509-tsp 0.1.0` and `sigstore-tsa 0.8.0`; the official
Sigstore Rust conformance source was frozen at commit
`5fa7a5ed04d3cb7258c65856117d60ffb0db952f`. Locked metadata and license review covered 393
packages with no missing license declarations. Package-boundary QA found 430 files, zero source
maps/sources/PDBs, Utility-only native-addon loading and coherent
0.7.0/1.6.0/1.5.0/0.4.0 versions. A separate normal launch exposed no QA/CDP port and exited
cleanly. The frozen Windows x64 EXE is 205,586,944 bytes with SHA-256
`948b3c97a87eb5dd5d4b7823d4916f7ad4fb66e9345288eade9ffd614685f850`; ASAR SHA-256 is
`e24a616e8174025fc565d118bd4d4660e57a403c7400000b293dd23d76553e76`; native-addon SHA-256 is
`ebb32a602ee2f239ca3156b07d551ab6294380e1c13c4348f3a39ad23d8db02d`; CLI SHA-256 is
`b091d4d801ace277e154e7902ac6f9a601c19e91456543924af3a20531a5bfd9`. Final structured evidence
is under `test-results/AP-032/`. macOS was not executed and is not claimed.

C2PA 2.2 bridge (AP-033, 2026-07-16): passed through Workbench 0.8.0 at
workspace-root `app/AIGC-Proof-Workbench/AIGC-Proof.exe`. Protocol/engine/workspace 0.5.0 reads
bounded `c2pa.claim.v2` embedded manifests and explicit local `.c2pa` sidecars for JPEG, PNG and
WebP, retains read-only claim-v1 compatibility, and records only a digest-bound normalized C2PA
observation. Signer, C2PA TSA, RFC 3161 TSA, creator-key and future official-identity trust remain
separate. Remote-manifest lookup, soft-binding lookup, MP4/PDF, future claim versions and arbitrary
assertion text are refused or excluded from the trusted UI boundary. C2PA validity is provenance
metadata; it does not prove factual truth, identity, originality, copyright, ownership or rights.

AP-035 updates the reviewed runtime dependency to `c2pa 0.89.3` with only `file_io` and
`rust_native_crypto`; default networking and OpenSSL are absent. The runtime source is official
tag object/peeled commit `c2pa-v0.89.3` / `4b9caf5398ca0e0106f989306daa00a9955504ea` /
`e2c90ec7f1fd0a3c90adfaf93107e19abd5383b8`, crates.io SHA-256
`033a638e07c1c6194f0e0964e2cf0c1848109b25cc77d7070a9417e59005b010`, and uses the fixed
`quick-xml 0.41.0`. Frozen independent evidence retains the AP-033 SDK 0.85.0 commit
`3f40cdd22b60bf955d531b0301604e3f257e0a19` as a read-compatibility corpus, plus conformance-public commit
`5e0e60d90cf8656b4e92320eda7c783ddd1808bf`, C2PA Attacks commit
`f4af902ea55dfe43c5ce27d5079ba3c47153466c`, and c2patool 0.26.60 crate SHA-256
`3d41841f6269d593dcebe35fd69e63a84d912ea87388f22265c824e6f7bf8e8d`. The frozen 32-image
attack set, independently generated reference reports, malformed JUMBF/media, tamper, remote,
soft-binding, future-version, assertion/ingredient and byte-limit cases are under
`test-results/AP-033/`.

Native Windows MSVC and actual Ubuntu WSL2 both used isolated Rust 1.88.0 toolchains and passed
locked formatting, checks, warnings-denied all-target Clippy, every applicable workspace test,
documentation/doc-tests, metadata/tree and explicit credential-store behavior. Windows executed
64 normal Rust tests plus the separately enabled OS-credential lifecycle; Ubuntu executed 67 plus
the persistent-store-unavailable fail-closed path. The 11 C2PA bridge tests exercised the real
official fixtures and all 32 generated attack assets. The final feature graph contains no active
remote-fetch or OpenSSL feature.

Windows Node v24.14.0/pnpm 11.7.0 passed Prettier, all TypeScript checks, ESLint, 7 Host-contract
tests, 16 creation-core tests, 76 Desktop tests and production builds. Development and exact
packaged Electron/CDP QA passed the complete creator-signature, RFC 3161, C2PA, ComfyUI v0.27.0,
portable proof, crash recovery, restart and corruption-recovery workflows. The final packaged run
recorded 74 passing assertions, including embedded and sidecar JPEG/PNG/WebP, future-claim refusal,
official attack-content isolation and digest-bound observation creation. Package-boundary QA found
430 files, zero source maps/sources/PDBs and Utility-only native-addon loading. A separate normal
launch exposed no QA/CDP port and exited cleanly. The real generated output SHA-256 is
`718878f075ae0dd018951743dd749140b6a74f58c1482c3cdd63f646b6772aaa`; the creation-package
SHA-256 is `5152856b4b6e4292e3c4def755cb7e51918783e221e934fd68c2fd34f8ebabf3`.

The Windows x64 EXE is 205,586,944 bytes with SHA-256
`eef34f7b8fc828ac24e5d8d81a17365b862fa74f1bbdb9e14fc1af7eefb462dc`; ASAR SHA-256 is
`9def0c3e3084a280131a2fc2c3d60c28daaeecdb66d5cbd6490d97d03334f9cb`; native-addon SHA-256 is
`733113669c488f22fc0768f141deffd1f90949c9c2f5cb2c58823a41a59039a2`; CLI SHA-256 is
`cfa15c9d11c3b68b4d5af05e1dc708b4e142bac8ac4d49bd541a802d81acf919`. Final structured
evidence and reviewed screenshots are under `test-results/AP-033/qa/packaged/`. macOS was not
executed and is not claimed.

Stable interoperable assurance (AP-035, 2026-07-17): passed through protocol/engine/workspace and
Workbench 1.0.0 with Host/native API 2.0.0. The stable protocol retains exact 0.2/0.3/0.4/0.5
read verification, rejects downgrade and unknown members, makes trusted time optional for new 1.0
packages, and keeps Internal Integrity, self-asserted creator signature, RFC 3161, C2PA 2.2 and
official identity as independent evidence. Public offline official-identity verification accepts
only bounded deterministic COSE/JCS artifacts, an explicit issuer trust snapshot, caller-supplied
creator fingerprint/purpose/time/rollback/freshness policy and a signed status snapshot. It has no
private-service, moving-root, account, proofing-evidence, network or issuer-private-key path.

The exact security-maintained runtime is `c2pa 0.89.3` with default features disabled and only
`file_io` plus `rust_native_crypto`; AP-033 SDK 0.85 fixtures remain read-compatibility inputs.
Official c2patool 0.26.60 matched embedded/sidecar/tamper results, OpenSSL and the frozen Sigstore
corpus matched RFC 3161 results, and an independent Python CBOR/OpenSSL verifier accepted the
sanitized AP-034 producer format. New verification accepted valid packages created under every
old protocol; AP-031 through AP-033 verifiers all rejected the new 1.0 package, with AP-032/033
reporting `UNSUPPORTED_SPEC_VERSION` and AP-031 failing its strict 0.3 Schema.

Native Windows `x86_64-pc-windows-msvc` and actual Ubuntu 24.04 WSL2 both used Rust 1.88.0 and
passed locked formatting, all-target/all-feature checks, warnings-denied Clippy, documentation,
metadata/tree, complete applicable tests, the real CLI smoke path and current/compatibility C2PA
corpora. Windows passed 71 normal tests plus the explicit OS-credential lifecycle; Ubuntu passed
74 applicable tests and the expected fail-closed unavailable credential-store path. The frozen
RustSec database at commit `9f3e138091487e69144f536d36976e427a7a3307` found no unignored
advisory; the reviewed exceptions remain RSA timing advisory RUSTSEC-2023-0071 with no private-key
path/fix and build-only unmaintained proc macro RUSTSEC-2024-0370. The locked graph contains 522
packages, 518 third-party packages, no missing license declaration and no forbidden license.

Windows Node v24.14.0/pnpm 11.9.0 passed Prettier, all TypeScript checks, ESLint, 7 Host-contract
tests, 16 creation-core tests, 77 Desktop tests and production/release builds. Sequential
development and refreshed packaged Electron/CDP runs each passed 82 observations across both
viewports, complete creation/signature/timestamp/C2PA/official-identity positive and negative
states, AP-034 producer fixtures, process/boundary recovery and clean exits. Package-boundary QA
found 430 files, zero source maps, coherent versions and Utility-only addon loading. A separate
normal launch exposed no QA/CDP port and exited cleanly.

The frozen Windows x64 EXE is 205,586,944 bytes with SHA-256
`2e4c4b56ecf5a476508be75b57c71cb16b831bf565e180956618b464f9982ef7`; ASAR SHA-256 is
`e659d95c85d5913955fb4c83787bca3d941a93bb61d5a64ef8e94364280ee784`; native-addon SHA-256 is
`0501732b02d204c59cb019a1d6e393998ed647c85862ff49e9c9077c732c8b03`; release CLI SHA-256 is
`5f0e2999a3883188fbfc6fc5e10f520f75456f70895b91b183b80034665555b5`. Final evidence and
screenshots are under `test-results/AP-035/`. macOS was not executed and is not claimed as
passed. No independent or parallel QA, push, tag, release, upload or publication was started.

Optional external assurance tools (AP-036, 2026-07-17): passed through Workbench 1.1.0 and
Host/native API 2.1.0 without protocol, engine or workspace version drift from 1.0.0. The primary
creation, sealing and ordinary offline-verification journey remains usable with no TSA account or
C2PA trust profile. RFC 3161 acquisition and C2PA trust administration now live in one
keyboard-accessible advanced area that is collapsed by default and reports their configuration
states independently. RFC 3161 still requires explicit profile import and confirmation of the
endpoint, imprint and policy before Main performs HTTPS; local time, web clocks, NTP/NTS and
generic UTC services are not substitutes.

C2PA JPEG/PNG/WebP inspection now permits bounded local cryptographic and structural validation
without ambient roots or network activity. A structurally and cryptographically valid result is
reported as `valid_untrusted`, with signer and timestamp trust `not_evaluated`; invalid content
remains invalid. Importing an explicit profile enables the existing separate trust evaluation,
while creation of a digest-bound protocol observation still fails closed without both reviewed
snapshot digests. Profile parsing rejects signer or timestamp certificates with the wrong EKU.
Remote manifests, soft binding, OCSP fetching and telemetry remain disabled. The UI explicitly
states that RFC 3161 providers can involve third-party accounts, quotas, fees and availability,
and that C2PA validity or trust does not prove truth, identity, authorship, originality,
ownership or permission.

Native Windows `x86_64-pc-windows-msvc` and Ubuntu 24.04 WSL2 each used the frozen Rust 1.88.0
toolchain and passed locked formatting, all-target/all-feature check, warnings-denied Clippy,
documentation, metadata/tree, complete applicable tests, real CLI execution and the current plus
attack C2PA corpora. Windows also passed the explicit OS-credential lifecycle. `Cargo.lock` is
unchanged from AP-035 at SHA-256
`930e49effcf2dfcc05a842d6b5f4bb3b4bba4bbf1a8502d5efdc507d755abcc7`, so the reviewed RustSec
and license graph has no dependency drift.

Windows Node v24.14.0/pnpm 11.9.0 passed Prettier, all TypeScript checks, ESLint, 7 Host-contract
tests, 16 creation-core tests, 80 desktop tests and production/release builds. Sequential native
development and exact packaged Electron/CDP runs each passed 84 observations, including both
viewports, the unconfigured standard flow, trustless C2PA inspection, configured trust,
RFC 3161, official identity, process recovery and clean exits. Package-boundary QA found 430
files, zero source maps, coherent versions and Utility-only addon loading. A separate normal
launch exposed no QA/CDP port and exited cleanly.

The frozen Windows x64 EXE is 205,586,944 bytes with SHA-256
`1cf7301241a00ad918cf625e4044ffa8509b5b084f441f1ada3f309ef2ec4fc6`; ASAR SHA-256 is
`1f18604f9c9becce1edafd9046ea74811d723ce82ac6441d101f0b5bc238cc41`; native-addon SHA-256 is
`4317b27dd81d72b7c48c73b91fba7ab89155c8e07859a57a5f94ea15e4e4b2e1`; release CLI SHA-256 is
`4296177da1f0b5ee2d1415c73c57a56e50a9f23ae8d052f83c3f4a5c3054b1ec`. Final evidence and
screenshots are under `test-results/AP-036/`. macOS was not executed and is not claimed as
passed. No independent or parallel QA, push, tag, release, upload or publication was started.

Not implemented:

- Production online identity enrollment/proofing, accounts, provider integration or legal-name governance
- Standalone C2PA authoring/signing, remote lookup, soft binding, video/audio/PDF, or claim 2.3+
- Originality or copyright evaluation
- Hosted official-service deployment, production roots/keys, network APIs, WASM, or upload

A valid creator signature or RFC 3161 result does not turn a self-asserted label into verified
identity and does not establish originality, copyright, ownership, authorization, C2PA provenance
or official verification. Candidate validation does not imply publication or release.
