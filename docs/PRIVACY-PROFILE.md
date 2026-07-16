# Privacy Profile 0.5

The CLI runs offline and does not automatically upload workspaces, packages, prompts, parameters, or assets.

Event payloads are supplied through JSON files so sensitive prompt text does not need to appear directly in shell command history. The JSON file and package may still contain sensitive prompts, model parameters, personal data, licenses, and source assets.

Version 0.5 has no field encryption, selective disclosure, or automatic redaction. Users must inspect workspace and package contents before sharing them. File, key, trust-profile, signature, C2PA manifest-store, and certificate-snapshot digests can reveal equality and should not be treated as anonymous.

Raw external absolute paths are not stored in the Manifest. original_name is retained, so filenames themselves may be sensitive.

The Electron workbench uses no telemetry, account, upload, remote font, CDN, or cloud API. Its
optional creation provider communicates only with a user-authorized ComfyUI on loopback; remote
endpoints, redirects, credentials, cloud/partner nodes, downloads, and updates are rejected.
Electron Main stores local preferences, recent workspace/package paths, provider inventory,
creation sessions, indexes, and UI state in SQLite under the current user's application-data
directory. Those absolute local paths
can be sensitive; they remain on the device and can be rebuilt or deleted without changing the
portable proof files. The renderer never opens the database directly.

Workbench 0.8.0 exposes selected locations to the renderer only as opaque Host references plus
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

The local creator display label and public key fingerprint are intentionally embedded in each
signed 0.3/0.4/0.5 package and may link packages made with the same key. The private key remains in the
operating-system credential store and is never written to packages, workspaces, reports, SQLite,
renderer/preload IPC, or logs. Rotation creates a new linkability domain; it does not erase the
public identity evidence in already shared packages.

RFC 3161 acquisition is the Workbench's only non-loopback outbound product operation. It occurs
only after explicit user action and confirmation. The configured TSA receives the SHA-256 digest
of the creator COSE bytes, a random 128-bit nonce, the requested policy, and normal HTTPS network
metadata; it does not receive the Manifest, assets, prompt, creator label, public key, or COSE
bytes from this adapter. Ordinary verification remains offline. Imported TSA profiles and their
private HTTPS roots are held only for the current process and are not persisted in SQLite or the
proof package.

C2PA inspection is offline and receives only image bytes, an explicitly selected local sidecar,
and an explicitly imported session trust profile. Remote-manifest and soft-binding lookup, OCSP,
telemetry, and automatic trust retrieval are disabled. The portable observation records exact
image/manifest-store and trust-snapshot SHA-256 values, active manifest label, and normalized SDK
status codes; these values may link the same media, manifest, certificate population, or trust
profile across packages. Arbitrary assertion explanations, ingredient text, certificate subjects,
and remote content are not copied into the event or trusted UI. Imported C2PA roots remain
session-only and are not persisted in SQLite or bundled with the product.
