# Architecture

## Protocol engine

~~~text
init -> add -> record -> seal -> verify -> inspect
                   |
                   v
                proof-cli
                   |
                   v
                proof-core
      workspace / hash / JCS / events / ZIP / verifier
                   |
                   v
               proof-schema
          types / strict JSON / Schema / semantics
~~~

The workspace is mutable local staging data. Asset copy and both seal hashing passes are
streamed through hard byte bounds, and workspace asset directories and files are rechecked
against symbolic links. seal creates a new immutable-by-convention package path and refuses
overwrite. The package writer precomputes and validates asset metadata, writes stable entry
order, flushes and syncs a same-directory temporary file, self-verifies it, confirms the
destination remains absent, and persists without clobbering.

The verifier never extracts entries. Before constructing the ZIP reader it reads the bounded
EOCD/ZIP64 records to enforce the declared entry count and detect names silently collapsed by
the pinned ZIP library. It then performs container safety, Manifest, assets, and event-chain
stages. Container or Manifest failures may stop dependent stages; asset and event stages
collect multiple errors when safe.

JSON Schema expresses portable structure. Shared Rust validation enforces strict time, lowercase digests, stable sorting, cross-field rules, path traversal defense, case conflicts, ZIP metadata limits, and streaming byte checks. Rust is the execution layer but does not redefine public Schema field meanings.

The public workspace has no dependency on private official code or services.

## Desktop workbench 0.2.0 preview

~~~text
React + TypeScript renderer (untrusted presentation)
        | ProofHostApi 1.0.0
        v
Standalone Host adapter
        | typed window.aigcProof API
        v
context-isolated preload (allowlist only)
        | validated IPC
        v
Electron Main (dialogs, paths, lifecycle, security policy)
        | version/capability handshake + Node-API
        v
proof-napi (asynchronous adapter + bundled SQLite app state)
        |
        v
proof-core + proof-schema
        |
        v
portable workspace files / .aigcproof packages / JSON reports
~~~

The renderer has no Node.js, filesystem, SQLite, native-module, or generic IPC access. Main
validates every DTO, owns native dialogs and user-selected paths, and resolves short-lived typed
opaque references whose display labels/paths have no authority. It registers proof IPC only after
`proof_napi.node` reports compatible API 1.0.0, engine 0.2.0, protocol 0.2.0, deterministic
capabilities, and truthful execution facts. Rust remains the sole protocol and archive-security
implementation; Electron never shells out to the CLI.

SQLite stores workbench preferences, recents, indexes, and UI state. It is disposable application
metadata, not a proof format: losing it must not invalidate or make a workspace, report, or package
unreadable. See [ADR 0001](adr/0001-electron-workbench.md).

Workspace creation and opening are separate typed flows. The renderer supplies only an existing
parent plus a portable new-folder component for creation; Electron Main validates and joins them,
previews the normalized target, checks existence, and then calls Rust. Existing targets are never
initialized. Opening selects an existing workspace and calls the independent load operation.

The previous Win32 tactical preview was retired only after the packaged Electron replacement
passed its automatic developer acceptance. Electron is now the sole built and documented primary
desktop frontend. See [Desktop Workbench](DESKTOP-WORKBENCH.md).

## Versioned standalone host and prospective integration

`@aigc-proof/host-contracts` 1.0.0 is the reusable renderer-safe source of DTOs, strict Schemas,
versions, capabilities, errors, and `ProofHostApi`. The implemented Standalone adapter uses
Host-issued local references and the Workbench Main boundary. A deterministic Mock Host supports
consumer/component tests but is not registered by the packaged product.

A possible future AIGCStudio product may use its own proof UI while implementing the same reviewed
interface semantics and sharing `proof-core` / `proof-schema`. Its Bridge, asset-token/catalog
mediation, database/task/staging ownership, Utility Process policy, and dual-product packaged
acceptance remain unimplemented and require separate schemes.

See [Cross-host Integration Synchronization](INTEGRATION-SYNC.md) for the implemented,
standalone-only, and prospective boundaries. The external architecture used for comparison is a
reference only and introduces no AIGC-Proof dependency or change to protocol 0.2.0.

## Future layers

COSE signatures/identity, RFC 3161 trusted time, C2PA, official Axum/PostgreSQL/S3 services, and
Rust WASM require separate reviewed versions. They are not implemented or implied by the workbench.

## Planned Rights Protection track

The separate planned Rights Protection product track builds on portable public evidence without
changing protocol 0.2.0:

~~~text
portable original/publication observations
        + exact digests
        + versioned visual/audio fingerprints
        v
explainable candidate matches -> preserved evidence -> human review -> case export
~~~

Public layers will own later reviewed evidence formats, reference verification and matching
algorithms, and reproducible test vectors/corpora. Optional private services may own authorized
platform monitoring and commercial case operations while depending on stable public interfaces;
the public implementation must not depend on them. Similarity findings remain technical
observations, not legal conclusions. See
[Rights Protection Product Track](RIGHTS-PROTECTION-ROADMAP.md).
