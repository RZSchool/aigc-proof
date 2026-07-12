# Privacy Profile 0.2

The CLI runs offline and does not automatically upload workspaces, packages, prompts, parameters, or assets.

Event payloads are supplied through JSON files so sensitive prompt text does not need to appear directly in shell command history. The JSON file and package may still contain sensitive prompts, model parameters, personal data, licenses, and source assets.

Version 0.2 has no field encryption, selective disclosure, or automatic redaction. Users must inspect workspace and package contents before sharing them. File digests can also reveal equality with known content and should not be treated as anonymous.

Raw external absolute paths are not stored in the Manifest. original_name is retained, so filenames themselves may be sensitive.

The Electron workbench remains offline and uses no telemetry, account, upload, remote font, CDN,
or cloud API. Electron Main stores local preferences, recent workspace/package paths, indexes, and
UI state in SQLite under the current user's application-data directory. Those absolute local paths
can be sensitive; they remain on the device and can be rebuilt or deleted without changing the
portable proof files. The renderer never opens the database directly.
