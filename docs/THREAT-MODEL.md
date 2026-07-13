# Threat Model 0.2

## Detected inconsistencies

- Asset size or SHA-256 changes
- Missing, added, or reordered package entries
- Event payload, sequence, link, hash, count, or root changes
- Noncanonical or duplicate-member JSON
- Manifest structure or semantic violations

## Malicious ZIP controls

Container checks cover malformed ZIP/ZIP64, raw declared entry count, duplicate-name collapse,
traversal, absolute/drive/UNC/backslash paths, duplicate entries, case conflicts, duplicate
Manifest, explicit symbolic links, Unix special files, non-regular files, encryption,
compression methods, package bytes, one-entry size, total expanded size, structured-file size,
and compression ratio.

Unsafe containers stop before content-dependent processing. Safe containers are streamed in place and never extracted.

## Not protected

No creator signature or external witness exists. An attacker can generate a new internally consistent Manifest, event chain, and asset set. A valid report cannot establish identity, authorship, originality, rights, authorization, earliest creation time, trusted time, or legal validity.

SHA-256 collision resistance is assumed for comparison but does not create authenticity. ZIP
producer metadata can vary by platform; explicit link/special-file metadata is rejected and
non-extraction is mandatory. Same-directory temporary files and no-clobber persistence narrow
output races, but v0.2 does not claim protection against a hostile process concurrently mutating
the same local workspace. Cross-platform behavior must be tested against the pinned ZIP crate.

## Electron workbench boundary

The renderer is treated as untrusted presentation. It cannot access Node.js, arbitrary IPC,
filesystem APIs, SQLite, native modules, or Utility primitives. The preload allowlists typed
methods; Main validates every DTO, owns dialogs, paths, SQLite and bounded scheduling, and denies
renderer permissions/new windows/unexpected navigation. Renderer operations carry one-use or
scoped, expiring, session/origin/kind/permission-specific opaque references. Main rejects
malformed, forged, unknown, expired, consumed, cross-session, cross-origin, mismatched-kind/
permission, and changed-path references; any display label/path is ignored as authority. A
supervised Utility Process is the exclusive fixed Node-API owner, and Rust revalidates every
protocol input off the renderer and Main event loops.

Main validates the native discovery response before proof IPC registration. Missing/malformed
discovery, an unknown API major, an unexpected engine/protocol, or inconsistent capabilities/
limits fails closed with a stable startup diagnostic. The current addon uses napi-rs asynchronous
tasks in the Utility. Main permits one running and sixteen queued operations, bounds IPC size,
progress, and timeouts, and does not replay a job after Utility loss. Queued cancellation is
immediate; a running atomic Rust operation records `cancel_requested` but is not falsely claimed
to stop. Only known same-job temporary files are eligible for crash cleanup.

The SQLite database is not evidence and must not be trusted as the only copy of workspace or
package data. Corrupt or missing app state may remove preferences and recents, but must not change
proof validity. Normal production launch exposes no CDP port or DevTools; the automatic QA port is
enabled only by an explicit local test argument. Its deterministic selection manifest is rejected
unless that same explicit QA mode is active and is not part of the production preload contract.

## Local creation provider boundary

Renderer input cannot select an endpoint, command, workflow JSON, node class, output path, or
staging path. Main accepts only an authorized ComfyUI installation reference and constrained
generation fields. The Node creation core rejects non-loopback origins, URL credentials,
redirects, missing capabilities, incompatible versions, unsafe output components, oversized
responses, malformed images, mutated snapshots, invalid relationships, and invalid lifecycle
transitions. The fixed workflow contains only reviewed core checkpoint/prompt/latent/sampler/VAE/
save nodes; custom-node presence is diagnostic only and grants no execution authority.

Provider output is untrusted until Main validates its bounded image bytes and SHA-256 and writes a
no-clobber file under app-owned staging. The provider never receives SQLite or formal proof output
paths. Only a successfully completed output can map creation evidence; failed, timed-out, crashed,
or cancelled runs cannot become `proof_ready` or `complete`. Main still relies on Rust to copy,
hash, record, seal, inspect, and verify the portable evidence.

ComfyUI and checkpoints are external local components. Their reported version, checkpoint name,
job state, and time are observations, not verified software provenance, model-file hashes,
identity, rights, authorization, originality, signature, or trusted time. A hostile local provider
can return misleading but internally consistent content. The app does not protect a shared
ComfyUI queue from other local clients; it therefore avoids global interruption unless it owns the
managed child process.

The workbench does not defend against a hostile local administrator, runtime binary replacement,
or another process racing user-selected files beyond the core's existing no-clobber and recheck
controls. The preview is unsigned, so the operating system may identify its publisher as unknown.
