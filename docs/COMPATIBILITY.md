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

Workbench 0.1.0 is versioned independently from protocol 0.2.0. Its napi-rs bridge calls the same
public Rust core as the CLI, and its SQLite database is application metadata only. Workspaces,
packages, and JSON reports remain portable across clients without SQLite. Windows x64 is the
required packaged-workbench platform; Linux remains a required core/CLI regression platform and
macOS evidence is informational unless actually executed.
