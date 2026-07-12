# Desktop Workbench 0.1.1

## Architecture

The primary desktop frontend is an offline React + TypeScript application hosted by Electron.
The renderer is an untrusted presentation layer: it has no Node.js, filesystem, SQLite,
native-module, or generic IPC access. A context-isolated preload exposes only the typed
`window.aigcProof` API. Electron Main validates requests, owns dialogs and paths, and invokes the
allowlisted asynchronous napi-rs Node-API adapter.

`proof-napi` delegates all protocol behavior to `proof-core` and `proof-schema`; Electron does not
reimplement hashing, canonical JSON, event chains, ZIP handling, Schema validation, or verification.
SQLite stores only disposable preferences, recents, indexes, and UI state. Portable workspaces,
`.aigcproof` packages, and JSON reports remain authoritative.

This typed `window.aigcProof` surface is specific to the standalone Workbench, not a frozen API
for another host. A future AIGCStudio product may own a separately designed proof UI while sharing
the public Rust engine, but its Host contract, asset authorization, state ownership, process
isolation, and packaging have not been implemented. See
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

Workbench 0.1.1 uses protocol 0.2.0 and evaluates only package-internal integrity. It does not
provide creator identity, digital signatures, trusted timestamps, C2PA, originality evaluation,
copyright or ownership determinations, official services, accounts, upload, or WASM.

The previous Win32 tactical preview was retired from the source workspace only after the packaged
Electron replacement passed its automated development acceptance. Historical preview evidence may
remain outside the primary application delivery path for audit purposes.
