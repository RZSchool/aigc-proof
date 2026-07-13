# ADR 0003: Local creation-to-proof through a reusable Node core

- Status: accepted for Workbench 0.4.0
- Date: 2026-07-14
- Host/native API: 1.2.0
- Engine/protocol: 0.2.0 Internal Integrity

## Context

The standalone product needs to create content and connect the actual generated output to proof
evidence without asking the user to browse for that output afterward. The creation layer must
also be reusable by a future Host with a different UI, database, asset catalog, and task system.
It must not move provider, filesystem, SQLite, or native-addon authority into Renderer.

The selected first provider is an existing user-authorized local ComfyUI installation. Bundling
or downloading ComfyUI, Python/GPU runtimes, custom nodes, or model weights would create a
different distribution, licensing, update, and Windows-acceptance scope.

## Decision

1. `@aigc-proof/host-contracts` 1.2.0 owns renderer-safe creation/provider/session DTOs, strict
   Schemas, capabilities, references, errors, and the typed `ProofHostApi` surface.
2. `@aigc-proof/creation-core` 1.0.0 is independent of React, Electron, SQLite, and either Host's
   database. It owns canonical snapshots/digests, lifecycle transitions, the fixed workflow,
   provider observations, bounded output validation, and evidence mapping.
3. Standalone Main owns native dialogs, opaque reference resolution, installation/process
   validation, app staging, SQLite v2 sessions, automatic Rust proof jobs, and result publication.
4. The provider origin is fixed to credential-free loopback HTTP/WebSocket. Redirects, remote
   origins, arbitrary workflow JSON, commands, paths, and node classes are rejected.
5. The frozen v0.4 profile requires ComfyUI v0.27.0, reviewed GPL-3.0 license inventory, required
   API/WebSocket capabilities, the six core text-to-image node classes, and a reported checkpoint.
6. ComfyUI and all runtime/model/custom-node components remain external and user-managed. Their
   observed version, checkpoint name, time, and output do not establish provenance, identity,
   originality, ownership, authorization, signature, or trusted time.
7. Prompt disclosure is explicit. `included` persists prompt text in evidence; `digest-only`
   persists only hashes and keeps execution text in memory, so it cannot resume unrun after restart.
8. Failed, cancelled, crashed, timed-out, or malformed jobs cannot transition to evidence-ready or
   complete. A shared user-owned ComfyUI process is never globally interrupted; only an app-owned
   child may receive `/interrupt`.
9. A deterministic test provider supplies reproducible vectors, but packaged acceptance must run
   the real approved ComfyUI provider and the exact packaged Windows executable.

## Consequences

The generated image is automatically validated, staged, added as an `output` asset, and connected
to ordered creation events before sealing. SQLite can restore session/recent UI state after a
restart, but the portable workspace/package/report remains authoritative and independently
verifiable. A future AIGCStudio Host can reuse the contract/core/addon with its own authorization,
state, staging, and UI without launching or importing the Standalone application.

Protocol 0.2.0 and its unsigned Internal Integrity assurance remain unchanged. Cloud providers,
remote endpoints, signatures, trusted time, C2PA, official services, WASM, publication, and model
distribution require separate reviewed schemes.
