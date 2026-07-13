# Desktop Workbench 0.2.0

## Architecture

The primary desktop frontend is an offline React + TypeScript application hosted by Electron.
The renderer is an untrusted presentation layer: it has no Node.js, filesystem, SQLite,
native-module, or generic IPC access. Renderer code depends on `ProofHostApi` 1.0.0 through the
Standalone adapter. A context-isolated preload exposes only that typed surface. Electron Main
validates requests, owns dialogs and paths, and invokes the allowlisted asynchronous napi-rs
Node-API adapter.

`proof-napi` delegates all protocol behavior to `proof-core` and `proof-schema`; Electron does not
reimplement hashing, canonical JSON, event chains, ZIP handling, Schema validation, or verification.
SQLite stores only disposable preferences, recents, indexes, and UI state. Portable workspaces,
`.aigcproof` packages, and JSON reports remain authoritative.

The reusable contract is separately testable without Electron, React, Node globals, filesystem,
or native loading. The Standalone implementation issues opaque, expiring, kind-specific
references for native selections and recent records. Display labels and paths are user clarity
only; Main resolves the stored authority and rechecks the selected path when each operation runs.

Native discovery reports API 1.0.0, engine 0.2.0, protocol 0.2.0, implemented capabilities, napi-rs
asynchronous task execution, and the absence of Utility Process isolation, progress streaming,
and safe cancellation. Missing, malformed, incompatible, or capability-inconsistent discovery
stops startup before proof-operation IPC is registered.

A future AIGCStudio product may own a separately designed proof UI while implementing the same
contract semantics and sharing the public Rust engine. Its Bridge, asset-token integration, state
ownership, process isolation, and packaging have not been implemented. See
[Cross-host Integration Synchronization](INTEGRATION-SYNC.md).

## Guided flows

1. Create a portable workspace by selecting an existing parent directory and entering a new
   portable folder name. Main resolves and previews the target; an existing target is never
   initialized or overwritten.
2. Open an existing valid workspace through a separate directory-selection flow.
3. Add input, output, reference, license, or other assets.
4. Record a creation event from validated JSON.
5. Seal a new `.aigcproof` package without overwriting an existing file.
6. Verify package-internal integrity or inspect metadata without claiming verification.
7. Save a JSON verification report without overwrite.
8. Reopen recent workspaces and packages from rebuildable SQLite state.
9. Inspect exact application, contract, native API/engine, protocol, capability, and unavailable
   feature diagnostics.

## Security and QA

The BrowserWindow uses `nodeIntegration: false`, `contextIsolation: true`, and sandboxing. Main
denies permissions, new windows, unexpected navigation, and network requests. Normal packaged
launch does not expose DevTools or a remote-debugging port. A dedicated command-line QA flag is
required to enable loopback CDP for the Electron/CDP developer harness.

The harness drives the actual renderer and typed preload through create, add input/output, record,
seal, verify, report, inspect, reopen, SQLite rebuild, and tamper rejection. Package-boundary QA
also checks the ASAR contents, absence of source maps, security defaults, offline CSP, native addon,
normal launch, disabled CDP, and clean exit.

## Scope

Workbench 0.2.0 uses protocol 0.2.0 and evaluates only package-internal integrity. It does not
provide creator identity, digital signatures, trusted timestamps, C2PA, originality evaluation,
copyright or ownership determinations, official services, accounts, upload, or WASM.

The previous Win32 tactical preview was retired from the source workspace only after the packaged
Electron replacement passed its automated development acceptance. Historical preview evidence may
remain outside the primary application delivery path for audit purposes.
