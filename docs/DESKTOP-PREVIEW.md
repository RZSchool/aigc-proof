# Desktop Preview 0.2

## Decision

The preview is a Rust-native Win32 executable. It calls `proof-core` and `proof-schema` directly,
uses operating-system file/folder dialogs, and requires no Node.js, browser engine, development
server, remote font, CDN, account, telemetry, upload, or private repository.

This choice keeps the packaged Windows x64 artifact small and offline. The tradeoff is a deliberately
plain native interface and Windows-first delivery; a later reviewed desktop iteration may introduce a
cross-platform presentation layer without changing the 0.2 protocol.

## Guided flows

1. **Home / assurance banner** — identifies the 0.2 preview and always states that only package
   internal integrity is evaluated. Identity, signature, trusted time, and originality are absent.
2. **Create or reopen workspace** — choose/type a local path and optional project name. Existing
   workspaces are loaded; new paths are initialized without overwrite.
3. **Add asset** — choose a local regular file and role. The background operation copies and hashes
   through the streamed public core while the UI shows busy progress.
4. **Record event** — enter a portable event type and editable JSON object. Invalid JSON is rejected
   before the public event-chain operation runs.
5. **Seal** — choose a `.aigcproof` destination. Existing outputs are never overwritten.
6. **Verify** — choose a package, run every container/Manifest/asset/event stage, show stable error
   codes and paths, and optionally save the JSON report without overwrite.
7. **Inspect** — display package metadata separately with an explicit “integrity not verified” label.
8. **Reopen** — recent local workspace and package paths are stored under the current user's local
   application-data directory. No file contents or proof data leave the device.
9. **Error / long-running state** — operations run off the UI thread, action controls are disabled,
   and a native progress indicator remains active until a deterministic result is shown.

## Safety and scope

- The desktop layer does not implement hashing, canonicalization, event-chain, ZIP, Schema, or
  verification rules; those remain in the public core.
- Workspace, package, and report outputs retain no-clobber behavior.
- Verification output distinguishes `valid`, `invalid`, and operational `error`.
- Inspection never claims integrity verification.
- The preview does not establish authorship, identity, ownership, originality, copyright, trusted
  time, legal validity, digital signature, or official verification.
