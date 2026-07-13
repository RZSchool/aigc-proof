# ADR 0002: Supervised Utility Process and bounded proof jobs

- Status: accepted for AP-022 implementation
- Date: 2026-07-13
- Workbench version: 0.3.0
- Host contract/native API version: 1.1.0
- Proof engine/protocol version: 0.2.0

## Context

Workbench 0.2.0 correctly isolated its renderer but loaded `proof_napi.node` in Electron Main.
The napi-rs functions use asynchronous tasks, so they do not block the JavaScript event loop, but
a native crash would still take down Main and there was no observable bounded job lifecycle.
Workbench 0.3.0 also needs one continuous workflow page without changing protocol 0.2.0.

## Decision

Electron Main supervises one Electron Utility Process. The Utility Process is the only production
process that loads `proof_napi.node`; Main, preload, and renderer never require the addon. Utility
startup is fail-closed: a versioned handshake must report compatible native API 1.1.0, engine
0.2.0, protocol 0.2.0, capabilities, and limits before proof IPC is registered.

Main owns dialogs, opaque-reference authorization, real-path revalidation, the bounded scheduler,
SQLite application state, result publication, and window lifecycle. Utility receives only a
validated operation name and the already-authorized bounded paths/data needed by that operation.
It never receives renderer references, database authority, file/archive bytes over IPC, or a
generic command channel.

The production limits are:

| Limit | Value |
| --- | ---: |
| Concurrent native jobs | 1 |
| Queued jobs | 16 |
| Main/Utility message | 1 MiB serialized |
| Progress events | 10 per second per job |
| Utility handshake | 10 seconds |
| Proof operation timeout | 5 minutes |
| Utility shutdown | 5 seconds |

Job transitions are monotonic and validated:

~~~text
queued -> running -> succeeded | failed | cancelled
             |
             +-> cancel_requested -> cancelled | succeeded | failed
~~~

Queued jobs are cancelled immediately and never dispatched. The unchanged Rust 0.2 operations
are atomic/non-interruptible after dispatch: a running cancel request is visible as
`cancel_requested`, but the operation completes or fails under the existing no-clobber/temporary
file guarantees. The UI does not promise immediate interruption. Progress reports bounded named
phases (authorization, queue, Utility execution, result publication), not invented byte counts.

Timeout or Utility loss converts every affected running job to a stable failure. State-changing
jobs are never replayed automatically. Later work starts a fresh compatible Utility. Cleanup is
limited to paths that the operation itself owns through the existing core same-directory
temporary-file rules; Main does not delete user inputs or guess at native temporary names.

Opaque references are bound to a random application session, issuing renderer origin, kind,
permission set, expiry, immutable display fields, and the current canonical target. Output and
asset selections are one-use authorities; reusable workspace/package references are revalidated
on every operation. Display labels and paths never grant authority.

SQLite remains disposable Main-owned workbench state. Rebuilding recent indexes asks Utility to
validate candidates with the Rust engine, then Main publishes the validated list. Portable
workspaces, packages, and reports remain authoritative.

## Consequences

- Main remains responsive and survives a native Utility crash.
- A bounded queue, honest progress, cancellation requests, deterministic failure, and restart are
  observable through `ProofHostApi` 1.1.0.
- The single-page renderer remains presentation-only and obtains job updates only through one
  allowlisted subscription channel.
- API 1.1.0 is a compatible extension of 1.0 semantics; unknown major versions, missing required
  capabilities, contradictory limits, or malformed messages fail closed.
- Protocol/engine 0.2.0, archive security, assurance language, and portable formats are unchanged.

## Explicitly deferred

Cooperative interruption inside Rust hashing/archive phases, multiple Utility workers,
AIGCStudio deployment, signatures/identity, trusted time, C2PA, Rights Protection, official
services, network/upload, telemetry, code signing, and installers require separate review.
