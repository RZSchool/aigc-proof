# Desktop Workbench 0.8.0

## Architecture

The primary desktop frontend is a local-first React + TypeScript application hosted by Electron.
The renderer is an untrusted presentation layer: it has no Node.js, filesystem, SQLite,
native-module, Utility primitive, or generic IPC access. Renderer code depends on
`ProofHostApi` 1.7.0 through the Standalone adapter. A context-isolated preload exposes only that
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

Native discovery reports API 1.6.0, engine 0.5.0, supported protocols 0.2.0, 0.3.0, 0.4.0, and 0.5.0, implemented capabilities,
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
scrollable canvas keeps three primary outcomes visually dominant: verify a held image; create or
open a workspace; and generate locally plus complete its proof once. Package-only verification,
metadata inspection, and report saving remain an independent tool rather than a required
continuation of creation. Jobs and preferences remain visible on the same page.

Manual import of all five asset roles, arbitrary structured event recording, and manual workspace
sealing remain available together in the collapsed `高级：手工证明工具` disclosure at the end of
the canvas. They have no primary step numbers and are described as expert/imported workflows.
Integrated creation adds its successful output automatically and its one final primary action
seals, fully verifies, and saves the report without handing the user to another seal action.

Creation history is requested with the current opaque `WorkspaceReference`; Main resolves that
authority and queries only the canonical workspace's SQLite records. Startup and workspace entry
do not auto-select history. Switching workspaces or creating a session clears selected output,
package, report, inspection, and image-match state before showing a blank/new scope. Only an
explicit `恢复历史会话` choice restores that session's proof context. Saving an output copy may
prefill the independent image verifier for the current session, with replace/clear controls; a
scope or session change discards that convenience state.

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
identity, originality, ownership, authorization, or trusted time. Provider observations are not signer identity evidence.

## Generated images and package correspondence

A completed creation session shows a bounded Main-produced thumbnail, filename, size, SHA-256,
proof ID, and package relationship. `保存生成图片副本` selects a new extension-appropriate output
through Main. Rust reloads the portable workspace, requires the session asset to have role
`output`, rejects unsafe paths, rechecks size and SHA-256 while streaming, syncs a temporary file,
and atomically publishes without clobber.

`验证我的图片` accepts a PNG, JPEG, or WebP and one `.aigcproof` package without requiring a
workspace. The Rust operation fully verifies the same package instance before reading the
external image, then reports exactly one of `verified_output_match`, `matched_non_output`,
`not_in_package`, or `package_invalid`. Filenames are display evidence only; size plus SHA-256
determines equality, so an unchanged renamed copy matches and any byte change does not. A match
confirms only byte correspondence to a cryptographically verified Manifest `output`; the creator
label remains self-asserted and does not establish real identity, authorship, originality, ownership,
earliest creation, or trusted time.

Cancellation never publishes a successful output proof. A user-owned shared ComfyUI process is
not globally interrupted because that could affect unrelated queue users; AIGC-Proof discards its
own result relationship instead. Global `/interrupt` is allowed only for a child process started
and owned by this app.

## Security and QA

The BrowserWindow uses `nodeIntegration: false`, `contextIsolation: true`, and sandboxing. Main
denies permissions, new windows, unexpected navigation, and network requests. Normal packaged
launch does not expose DevTools or a remote-debugging port. A dedicated command-line QA flag is
required to enable loopback CDP for the Electron/CDP developer harness.

The harness drives the actual renderer and typed preload through isolated operating-system signer
creation, explicit signature confirmation, signed sealing/verification, image selection/matching,
two-workspace scoped history/reset checks, explicit restore, new-session clearing, create/open,
all five asset roles and the explicitly opened advanced disclosure,
real ComfyUI creation, automatic output ingestion, snapshot/evidence review, creation seal/verify/
report, visible thumbnail, exact no-clobber image export, independent output match, modified and
non-output classification, invalid-package refusal, restart/export/match, native CLI verification,
offline C2PA JPEG/PNG/WebP embedded and explicit-sidecar inspection, remote/PDF/soft-binding
rejection, digest-bound observation creation,
record, manual seal/no-clobber, verify, report/no-clobber, inspect, reopen, SQLite restart/rebuild/
corruption recovery, queue/cancellation, Utility crash/restart/no-replay, Unicode/space paths,
malformed/tampered rejection, and clean exits. It also captures and inspects the unified page at
1320x880 and 1040x720. Package-boundary QA checks ASAR contents, Utility-only addon loading,
absence of source maps/sources/PDBs, security defaults, offline CSP, native discovery, normal
launch, disabled CDP, and clean exit.

## Local creator identity

Workbench 0.8.0 manages one local Ed25519 identity through the operating-system credential store.
The renderer sees status, self-asserted display label, public fingerprint, and warnings only. Main
validates every request and the Utility invokes the Rust signer. Creation, rotation, disable, and
each package signature require explicit user actions. Private bytes never enter renderer, preload,
IPC payloads, SQLite, workspaces, packages, reports, or logs. Credential-store failure closes the
feature instead of falling back to weaker storage.

Verification displays internal integrity, signature validity, local key match, and trusted-time
state separately. A valid signature proves possession of a key for the exact Manifest; it is not
real-name, originality, copyright, ownership, authorization, or official verification.

## RFC 3161 trusted time

The trusted-time panel imports one explicit portable TSA snapshot into the current process. Main
validates its digest, endpoint scope, policy list, certificate material, effective time, and expiry
through Rust before retaining it; the snapshot is not persisted in SQLite. When a 0.4 package and
new output are selected, the renderer can request only the fixed operation—it cannot supply a URL,
request body, trust root, response, or generic fetch parameters.

Normal launch displays the endpoint, policy, and exact creator-signature SHA-256 imprint before
Main sends the request. Main enforces HTTPS, imported HTTPS roots, no redirects, 10-second connect
and 30-second total timeouts, exact media type, and a 1 MiB response cap. Utility/Rust verifies the
response before a new no-clobber package is published. Cancellation and acquisition failure leave
the creator signature valid and publish no package. All later verification is offline against the
explicit snapshot. See [Trusted Time Profile](TRUSTED-TIME-PROFILE.md).

## C2PA 2.2 bridge

The C2PA panel imports one explicit signer/TSA trust profile for the current process and accepts
only a user-selected JPEG, PNG, WebP, and optional lowercase local `.c2pa` sidecar. Main validates
opaque regular-file references and the Utility performs bounded SDK validation with all remote
manifest, OCSP, and soft-binding fetch behavior disabled. The UI shows claim version, source mode,
media/manifest digests, validation state, signer trust, and timestamp trust separately.

An ingested workspace image can receive a `c2pa_observation` only after Rust rehashes it and
matches the recorded asset digest. The observation is subsequently covered by the event chain and
creator signature. Standalone Workbench has no C2PA certificate private-key import or production
writer. C2PA validity is provenance metadata, not truth, human identity, authorship, originality,
ownership, copyright, permission, or non-infringement. See [C2PA Bridge Profile](C2PA-BRIDGE.md).

## Scope

Workbench 0.8.0 uses protocol 0.5.0, verifies protocol 0.4.0/0.3.0 and legacy unsigned 0.2.0, and evaluates internal
integrity, creator signatures, optional RFC 3161 trusted time, optional bounded C2PA observations, and exact byte correspondence to verified package assets. It does
not provide external creator identity, originality evaluation, copyright or ownership
determinations, official services, accounts, upload, or WASM.

The previous Win32 tactical preview was retired from the source workspace only after the packaged
Electron replacement passed its automated development acceptance. Historical preview evidence may
remain outside the primary application delivery path for audit purposes.
