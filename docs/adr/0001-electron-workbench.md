# ADR 0001: Electron workbench over the Rust proof engine

- Status: accepted for AP-012 implementation
- Date: 2026-07-12
- Workbench version: 0.1.0 preview
- Proof protocol version: 0.2.0 Internal Integrity

AP-020 evolves this accepted boundary without changing its decision: Workbench 0.2.0 introduces
`ProofHostApi` 1.0.0, a Standalone adapter, typed opaque Host references, and fail-closed native
API/engine/capability discovery. Actual AIGCStudio integration and Utility Process isolation remain
outside this ADR and unimplemented.

## Context

The native Win32 desktop preview proved that the public Rust engine can support a directly
launchable offline GUI. It is a tactical reference client, not the target workbench architecture.
The target needs a maintainable React presentation layer without moving protocol or filesystem
security logic into JavaScript.

## Decision

The primary workbench is split into five ownership boundaries:

1. The React + TypeScript renderer is untrusted presentation. It has no Node.js, filesystem,
   SQLite, native-module, or generic IPC access.
2. A context-isolated preload exposes only the typed `window.aigcProof` methods declared by the
   shared contract. It cannot forward arbitrary channels or commands.
3. Electron Main owns application lifecycle, native dialogs, user-selected paths, allowlisted IPC,
   request validation, report persistence, security policy, and native-addon loading.
4. The `proof-napi` Node-API addon is a narrow asynchronous adapter over `proof-core` and
   `proof-schema`; it never shells out to the CLI and does not redefine protocol behavior.
5. Bundled SQLite stores preferences, recent workspace/package indexes, window/UI state, and
   optional operation history. Portable workspace files, assets, events, reports, and
   `.aigcproof` packages remain authoritative and usable without the database.

Production windows use `nodeIntegration: false`, `contextIsolation: true`, renderer sandboxing,
a strict local-content CSP, denied permissions, denied new windows, denied unexpected navigation,
and no remote runtime resources. A CDP port is enabled only by an explicit QA launch argument and
is absent from normal launch.

## Consequences

- Rust remains the single implementation of hashing, JCS, event chaining, ZIP safety, sealing,
  verification, inspection, and Schema semantics.
- The CLI remains an independent client of the same core and is never used as an Electron bridge.
- Node and Electron increase packaged size, so package-boundary and offline checks are required.
- Native addon and SQLite compatibility must be exercised on the packaged Windows artifact.
- The Win32 preview remains available until replacement acceptance passes, then leaves the primary
  workspace and current documentation so two competing main frontends are not maintained.

## Explicitly deferred

COSE/signatures and creator identity, RFC 3161 trusted time, C2PA/Content Credentials, official
Axum/PostgreSQL/S3 services, accounts, telemetry, cloud APIs, and Rust WASM remain separate future
phases. Nothing in this decision changes or upgrades unsigned protocol 0.2.0 assurance.
