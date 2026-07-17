# Cross-host Integration Synchronization

## Purpose and reference snapshot

This document distinguishes the architecture already implemented by AIGC-Proof from a possible
future AIGCStudio-hosted product shape. It uses the AIGC Wallpaper Engine (AWPE) architecture as
an external cross-product reference for the principles of separate products, one shared core,
reviewed interface semantics, and independently designed UIs. AWPE is not an AIGC-Proof protocol
authority, runtime dependency, or implementation baseline.

The reference was re-read on 2026-07-13 from external Git revision
`7794b613bd5da063e95cabe7d9f14ca6544309e5`. Because that external working tree contained
uncommitted documentation changes, these SHA-256 values identify the exact content reviewed:

| External document          | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `ARCHITECTURE_BASELINE.md` | `35641c542d9b34fd9019479f9eba96007d6abbed008a3b11d225f6d0c31fc67e` |
| `PROJECT_SYNC.md`          | `cf3d0726dbad8f25941120a02892dab76f2b193d98f5913be00c19a28de1afdc` |
| `SOLUTION_SYNC.md`         | `7b53895502337c665dda5dfcc44932a351e55c495a2ee539eacc593e614d1f6b` |
| `INTEGRATION_SYNC.md`      | `e9f08e8a45dc223201367c75a5b84330b4f68d1a4b97bdc940434e1f4f5d84e3` |

The snapshot records design input only. It does not import AWPE features, APIs, native addons,
workers, UI, version numbers, or implementation status into AIGC-Proof.

## Status vocabulary

- **Implemented today** means code and packaged acceptance exist in the standalone AIGC-Proof
  Workbench.
- **Standalone-only** means the behavior is valid for that product but is not a cross-host
  contract.
- **Prospective** means a future integration boundary that is not implemented, packaged, or
  accepted today and requires a separate reviewed development scheme.

## Alignment implemented today

The CLI and Electron Workbench share the public Rust `proof-core` and `proof-schema` engine rather
than reimplementing proof behavior for each UI. The renderer remains untrusted presentation: its
typed, context-isolated preload reaches allowlisted IPC, while Electron Main owns validation,
paths, dialogs, lifecycle, SQLite, authority, and bounded scheduling. A supervised Utility Process
is the exclusive `proof_napi.node` owner. The addon is a narrow asynchronous Node-API adapter over
the Rust engine; Electron does not shell out to the CLI.

Workbench 1.1.0 uses `@aigc-proof/host-contracts` 2.1.0 as the single renderer-safe source of
`ProofHostApi`, DTOs, strict Schemas, versions, capabilities, and stable errors. The Standalone
adapter and a deterministic consumer-test Mock implement that contract. Native API 2.1.0 reports
engine/protocol 1.0.0 plus legacy 0.2.0/0.3.0/0.4.0/0.5.0 support, deterministic capabilities, execution facts, and limits; Main validates
the Utility handshake and fails closed before proof IPC registration.

`@aigc-proof/creation-core` 1.0.0 is the Host/UI/database-independent Node layer for creation
snapshot canonicalization, lifecycle transitions, fixed provider workflow construction, bounded
provider observations, and deterministic evidence mapping. Standalone Main supplies only its own
authorized paths/staging and persists its own SQLite v2 records. A future AIGCStudio Main can call
the same package with its own authorized IDs, paths, assets, database, and tasks without importing
the Standalone React UI or launching `AIGC-Proof.exe`; that integration is still prospective.

Portable workspace files, `.aigcproof` packages, and JSON reports remain authoritative. The
standalone application's SQLite state is disposable and cannot redefine those formats. These
properties align with the shared-core and controlled-host-boundary principles without creating a
dependency between AIGC-Proof and AWPE.

## Valid standalone-only behavior

`window.aigcProof` is the implemented Standalone preload transport for `ProofHostApi` 2.1.0.
Main-owned native dialogs and user-selected local paths are legitimate in the standalone product,
but the renderer receives only kind-specific opaque references plus non-authoritative display
information. An AIGCStudio asset identifier or session token belongs to its future adapter and is
not implemented by the current offline Workbench.

AIGC-Proof and AWPE are separate products with separate native modules. AIGC-Proof does not use
wallpaper capabilities or external generation-worker protocols. Its offline proof operations do
not require an additional worker protocol.

## Prospective AIGCStudio boundary — not implemented

A future integration could use this boundary, subject to a separate architecture and security
review:

```text
AIGCStudio proof UI
        | ProofHostApi 2.1.0 through a prospective AIGCStudio adapter
        v
context-isolated preload / allowlisted IPC
        v
AIGCStudio Main
        | authorization / asset catalog / task lifecycle / staging
        v
supervised Utility / proof_napi.node
        v
proof-core / proof-schema
        v
portable workspace / package / report files
```

AIGCStudio may own and independently design its proof UI; it would not be required to reuse the
Workbench React pages. If such a product shape is later authorized, both UIs must use the same
public proof engine and reviewed interface semantics. Visual page reuse is optional; divergent
protocol algorithms are not.

The reusable `ProofHostApi` and native discovery exist in the Standalone product, but nothing in
that diagram has been implemented as an AIGCStudio runtime integration. In particular, the
AIGCStudio adapter/Bridge, asset-token mediation, Host proof task/staging services, Host database
ownership, Utility profile, and dual-product packaging have not been implemented or accepted.

## Current-versus-prospective boundary

| Concern            | Standalone Workbench today                                                                                                                         | Prospective AIGCStudio host                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Renderer API       | `ProofHostApi` 2.1.0 through typed `window.aigcProof` and Standalone adapter                                                                       | AIGCStudio adapter/Bridge implementing the same semantics, not implemented                                         |
| Input authority    | Main issues expiring typed references for selected paths and recent records; display paths are not authority                                       | AIGCStudio asset/workspace/package references or session tokens, not implemented                                   |
| Native interface   | API 2.1.0, engine 1.0.0, 0.2/0.3/0.4/0.5/1.0 protocol list, trustless/explicit-trust C2PA and official identity capabilities, execution facts, limits, and fail-closed compatibility | Same reviewed addon/contract assembled and accepted in AIGCStudio, not demonstrated                                |
| Creation layer     | Shared creation-core 1.0.0; Standalone Main owns ComfyUI authorization, staging and SQLite                                                         | Same core with Studio-owned provider/assets/tasks/state; not implemented                                           |
| Native execution   | Supervised Workbench Utility exclusively loads the addon; bounded jobs, progress, no-replay crash recovery, and truthful cancellation are accepted | AIGCStudio-owned Utility profile and crash-containment acceptance, not implemented                                 |
| Application state  | Disposable Workbench SQLite preferences, recents, indexes, and UI state                                                                            | AIGCStudio owns its database, asset catalog, tasks, staging, and publication; proof integration is not implemented |
| Packaging evidence | Packaged standalone Workbench accepted                                                                                                             | One contract/addon assembled into two products with separate UIs, not demonstrated                                 |

The implemented contract and discovery must not be used as evidence that the prospective
AIGCStudio adapter or its Host systems exist. Likewise, the standalone SQLite database grants no
permission to read or write an AIGCStudio database, asset catalog, staging area, or final
publication location.

## Gates before any future implementation

A future integration needs its own scheme and, at minimum:

1. a reviewed AIGCStudio adapter profile for `ProofHostApi` 1.x, including its supported
   capabilities, stable Host errors, compatibility refusal, and shared consumer vectors;
2. renderer-safe asset/workspace/package references or scoped session tokens, with authorization
   and real-path resolution owned by AIGCStudio Main;
3. explicit ownership for SQLite, asset catalog, task lifecycle, staging, cleanup, and publication;
4. a Utility Process/crash-containment decision plus timeout, cancellation, crash, and restart
   acceptance for expensive native work;
5. threat, privacy, path-boundary, and failure-mode review;
6. packaged contract tests and real workflow acceptance in both products.

Until those gates pass, documentation must continue to describe AIGC-Proof as a standalone CLI
and Workbench. Protocol 0.3 local signatures do not imply that an AIGCStudio adapter, trusted
time, C2PA, official services, or any additional assurance exists.
