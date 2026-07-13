# Compatibility Notes

## 0.1 to 0.2

The retained schemas/v0.1 files are draft history and are not valid 0.2 artifacts.

Version 0.2 introduces the workspace workflow; Manifest tool/project/assets model; event sequence starting at 1; canonical UTC Z timestamps; structured assurance; stable error codes; exact stable ZIP entry order; and centralized defensive limits. The previous temporary hash/create CLI and files/event-chain draft model are incompatible and removed from public documentation.

Small packages may use ordinary ZIP records. ZIP64 is supported only when standard fields are insufficient; it is not forced for every package.

JSON Schema describes field structure, basic lexical constraints, event/root relationships,
and verification status/assurance relationships. It cannot express every uniqueness, ordering,
archive-metadata, role/path, or cross-platform filesystem rule. Shared Rust validators are the
execution layer and must not change the Schema field meanings. Package components reject
Windows device names, forbidden characters, control characters, and trailing dots/spaces;
backslashes, drive/UNC paths, dot components, and NUL remain forbidden on every platform.

The pinned zip crate interprets explicit Unix symbolic-link metadata and supports standard
ZIP/ZIP64 reading. It also collapses duplicate decoded names in its public archive map, so the
verifier independently compares EOCD/ZIP64 declared counts before trusting that map. Because
producer metadata varies, symbolic links and Unix special-file types are rejected, entries are
never extracted, and Windows/Linux/macOS CI remains a release gate. Windows CI is configured to
run the native PowerShell smoke path as well as the shared integration and security tests; those
tests exercise relative Windows paths, CRLF JSON, case-conflicting archive names, no-clobber
writes, and internal temporary-file cleanup.

Cargo.lock is committed. Direct dependencies retain the exact Cargo.toml versions; only the
idna/ICU4X transitive line is held to Rust 1.85-compatible releases rather than the newer
Rust-1.86-only line.

Unsigned 0.2 packages must never be reinterpreted as signed, identity-verified, officially verified, or trusted-time evidence by later versions.

Workbench 0.3.0 is versioned independently from protocol 0.2.0. Its napi-rs bridge calls the same
public Rust core as the CLI, and its SQLite database is application metadata only. Workspaces,
packages, and JSON reports remain portable across clients without SQLite. Windows x64 is the
required packaged-workbench platform; Linux remains a required core/CLI regression platform and
macOS evidence is informational unless actually executed.

Workbench 0.3.0 preserves the separate create and open path semantics introduced in 0.1.1.
Creation accepts an existing parent and a new portable folder component; Electron Main resolves
the final target and preserves the core's strict no-overwrite rule. Opening continues to require
an existing valid workspace.

Workbench 0.3.0 replaces Main-owned native loading with a supervised Utility Process and adds
bounded asynchronous jobs, phase progress, truthful cancellation states, and a one-page UI. These
are application/runtime changes only; they do not change workspace files, `.aigcproof` packages,
reports, protocol 0.2.0, or assurance.

## Workbench 0.3.0 compatibility matrix

| Layer | Version | Compatibility behavior |
| --- | --- | --- |
| Workbench application | 0.3.0 | Product/UI/runtime version; does not change proof assurance |
| `ProofHostApi` contract | 1.1.0 | 1.1 adds bounded jobs, progress, cancellation states, runtime limits and Utility diagnostics; unknown major fails closed |
| Native API | 1.1.0 | Main validates the Utility discovery handshake before registering proof IPC; missing, malformed, unknown-major, or inconsistent capabilities/limits fail closed |
| Native engine | 0.2.0 | Exact engine expected by this Workbench |
| Proof protocol | 0.2.0 | Exact supported portable workspace/package/report semantics |

Native API 1.1.0 advertises only reviewed workspace, asset, event, package, verification,
inspection and execution capabilities. It truthfully reports napi-rs asynchronous tasks, Utility
Process isolation, and phase progress as available, while safe interruption of running atomic Rust
operations remains unavailable. Display paths returned with Host references are never
compatibility or authorization credentials.
