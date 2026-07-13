# Desktop Workbench 0.4.0

## Architecture

The primary desktop frontend is an offline React + TypeScript application hosted by Electron.
The renderer is an untrusted presentation layer: it has no Node.js, filesystem, SQLite,
native-module, Utility primitive, or generic IPC access. Renderer code depends on
`ProofHostApi` 1.2.0 through the Standalone adapter. A context-isolated preload exposes only that
typed surface. Electron Main validates requests, owns dialogs, paths, SQLite and bounded job
scheduling, and sends strict versioned messages to a supervised Electron Utility Process. The
Utility is the only production process that loads the allowlisted asynchronous napi-rs Node-API
adapter.

`proof-napi` delegates all protocol behavior to `proof-core` and `proof-schema`; Electron does not
reimplement hashing, canonical JSON, event chains, ZIP handling, Schema validation, or verification.
SQLite stores only disposable preferences, recents, indexes, and UI state. Portable workspaces,
`.aigcproof` packages, and JSON reports remain authoritative.

The reusable contract is separately testable without Electron, React, Node globals, filesystem,
or native loading. The Standalone implementation issues opaque, expiring, kind-specific
references for native selections and recent records. Display labels and paths are user clarity
only; Main resolves the stored authority and rechecks the selected path when each operation runs.

Native discovery reports API 1.2.0, engine 0.2.0, protocol 0.2.0, implemented capabilities,
execution facts, and runtime limits. The Utility handshake confirms process isolation and phase
progress; safe interruption of an already-running atomic Rust operation remains unavailable.
Missing, malformed, incompatible, capability-inconsistent, or limit-inconsistent discovery stops
startup before proof-operation IPC is registered.

A future AIGCStudio product may own a separately designed proof UI while implementing the same
contract semantics and sharing the public Rust engine. Its Bridge, asset-token integration, state
ownership, process isolation, and packaging have not been implemented. See
[Cross-host Integration Synchronization](INTEGRATION-SYNC.md).

## One-page workflow

The application menu, workflow sidebar, hidden routes, tabs, and page switching are absent. One
scrollable canvas keeps these regions visible in order: assurance/recent items; create/open;
current workspace and all five asset roles; local creation and automatic proof; event recording; package sealing;
verify/inspect/report; jobs/progress/cancel/history; and preferences/rebuild/diagnostics. Later
steps remain visible with their prerequisites instead of disappearing behind navigation.

Workspace creation selects an existing parent and one validated portable new-folder component;
Main previews the resolved target and never initializes an existing location. Opening remains a
separate valid-workspace selection. Packages and reports never overwrite existing outputs.

Main permits one native job to run and up to sixteen to queue. Progress reports bounded real
phases. Queued jobs cancel before dispatch. Cancellation of an already-running atomic Rust
operation is recorded honestly as `cancel_requested`; it is not presented as immediate
interruption. Utility loss fails the affected job with a stable code and no replay, removes only
known temporary outputs for that authorized job, and starts a fresh compatible Utility for later
work.

## Local creation-to-proof

The Standalone Host manages a user-authorized existing ComfyUI portable installation without
copying or updating it. The v0.4 profile requires exact detected ComfyUI v0.27.0, the reviewed
GPL-3.0 license inventory, loopback HTTP/WebSocket capabilities, the six required core node
classes, and at least one existing checkpoint. ComfyUI, Python/GPU runtimes, custom nodes, and
model weights are not bundled, downloaded, installed, or updated.

Renderer form fields are limited to a reported checkpoint observation, prompt/negative prompt,
seed, width, height, steps, CFG, and fixed sampler/scheduler enums. Main never accepts arbitrary
workflow JSON, endpoint URLs, commands, or provider output paths. The UI freezes an immutable
canonical snapshot and SHA-256, then `@aigc-proof/creation-core` builds the repository-owned
core-only graph. Main receives the exact output through the provider adapter, validates bounded
PNG/JPEG/WebP bytes, writes an app-owned no-clobber staging file, automatically adds it to the
portable workspace as `output`, and records the ordered creation evidence chain.

Prompt disclosure is explicit. `included` stores prompt text in the evidence snapshot;
`digest-only` stores only SHA-256 and keeps execution text in memory, so a frozen-but-not-run
digest-only session cannot resume after restart. Failed or cancelled jobs cannot transition to
evidence-ready or complete states. Provider/model/version/time facts remain observations, not
identity, originality, ownership, authorization, signature, or trusted time.

Cancellation never publishes a successful output proof. A user-owned shared ComfyUI process is
not globally interrupted because that could affect unrelated queue users; AIGC-Proof discards its
own result relationship instead. Global `/interrupt` is allowed only for a child process started
and owned by this app.

## Security and QA

The BrowserWindow uses `nodeIntegration: false`, `contextIsolation: true`, and sandboxing. Main
denies permissions, new windows, unexpected navigation, and network requests. Normal packaged
launch does not expose DevTools or a remote-debugging port. A dedicated command-line QA flag is
required to enable loopback CDP for the Electron/CDP developer harness.

The harness drives the actual renderer and typed preload through create/open, all five asset roles,
real ComfyUI creation, automatic output ingestion, snapshot/evidence review, creation seal/verify/
report/restart, record, manual seal/no-clobber, verify, report/no-clobber, inspect, reopen, SQLite restart/rebuild/
corruption recovery, queue/cancellation, Utility crash/restart/no-replay, Unicode/space paths,
malformed/tampered rejection, and clean exits. It also captures and inspects the unified page at
1320x880 and 1040x720. Package-boundary QA checks ASAR contents, Utility-only addon loading,
absence of source maps/sources/PDBs, security defaults, offline CSP, native discovery, normal
launch, disabled CDP, and clean exit.

## Scope

Workbench 0.4.0 uses protocol 0.2.0 and evaluates only package-internal integrity. It does not
provide creator identity, digital signatures, trusted timestamps, C2PA, originality evaluation,
copyright or ownership determinations, official services, accounts, upload, or WASM.

The previous Win32 tactical preview was retired from the source workspace only after the packaged
Electron replacement passed its automated development acceptance. Historical preview evidence may
remain outside the primary application delivery path for audit purposes.
