# @aigc-proof/creation-core 1.0.0

Reusable Node creation-to-proof semantics for Workbench 0.4.0. This package has no React,
Electron, SQLite, Standalone database, or renderer dependency.

It provides:

- deterministic canonical creation snapshots and SHA-256;
- explicit included/digest-only prompt disclosure;
- fail-closed creation-session lifecycle transitions;
- the repository-owned ComfyUI core text-to-image workflow;
- a loopback-only ComfyUI v0.27.0 provider adapter with redirect, response, output, and timeout
  bounds;
- stable successful-provider observation to proof-event mapping.

Host applications remain responsible for authorization, real paths, process ownership, staging,
database state, Rust proof operations, and result publication. Product code imports only the root
surface. `src/provider/deterministic-test.ts` is an explicit test-only generator and is not
exported or constructed by the packaged Main process.

ComfyUI, Python/GPU runtimes, custom nodes, and model weights are external user-managed
components. Their observations do not establish software provenance, identity, rights,
originality, signature, or trusted time. Protocol and native engine remain 0.2.0.
