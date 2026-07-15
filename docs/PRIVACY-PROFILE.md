# Privacy Profile 0.2

The CLI runs offline and does not automatically upload workspaces, packages, prompts, parameters, or assets.

Event payloads are supplied through JSON files so sensitive prompt text does not need to appear directly in shell command history. The JSON file and package may still contain sensitive prompts, model parameters, personal data, licenses, and source assets.

Version 0.2 has no field encryption, selective disclosure, or automatic redaction. Users must inspect workspace and package contents before sharing them. File digests can also reveal equality with known content and should not be treated as anonymous.

Raw external absolute paths are not stored in the Manifest. original_name is retained, so filenames themselves may be sensitive.

The Electron workbench uses no telemetry, account, upload, remote font, CDN, or cloud API. Its
optional creation provider communicates only with a user-authorized ComfyUI on loopback; remote
endpoints, redirects, credentials, cloud/partner nodes, downloads, and updates are rejected.
Electron Main stores local preferences, recent workspace/package paths, provider inventory,
creation sessions, indexes, and UI state in SQLite under the current user's application-data
directory. Those absolute local paths
can be sensitive; they remain on the device and can be rebuilt or deleted without changing the
portable proof files. The renderer never opens the database directly.

Workbench 0.5.1 exposes selected locations to the renderer only as opaque Host references plus
display labels/paths. Display information may still reveal sensitive local names to the local UI,
logs, or screenshots, but it grants no filesystem authority and is not stored in proof protocol
artifacts unless the existing portable format explicitly includes a filename.

Creation history is listed only after Renderer supplies the current opaque workspace reference;
Main validates and resolves it, then filters disposable SQLite records by its canonical workspace.
Startup, workspace changes, and new sessions clear transient thumbnails, proof/report presentation,
and image-verifier selections without deleting any persisted session or portable evidence.

Image-to-package matching streams the selected local image inside Rust after package verification;
the renderer receives only bounded display metadata, a digest/result, and an optional Main-made
thumbnail. Original image bytes, thumbnails, arbitrary path capabilities, and reusable file
tokens are not persisted in SQLite. A digest proves equality with declared bytes and may itself be
sensitive; it does not establish who created, owns, or first possessed the image.

Main sends only validated job DTOs and authorized paths to the local supervised Utility Process;
file bytes and SQLite contents are not copied through renderer IPC. Job history and recent items
remain local disposable application state. Utility isolation, progress, and crash diagnostics do
not introduce telemetry, upload, accounts, or external network access.

Creation snapshots require an explicit prompt disclosure choice. `included` places prompt and
negative-prompt text into portable event evidence. `digest-only` records their SHA-256 values and
keeps the execution text in memory only; it is intentionally unavailable after restart. Provider
evidence omits credentials, absolute external installation/output paths, environment dumps, and
unbounded logs. Declared checkpoint names and original asset filenames can still be sensitive,
and hashes may reveal equality with known content.
