# ADR 0004: Verify image bytes against a fully verified proof output

- Status: accepted for Workbench 0.5.0
- Date: 2026-07-14
- Host/native API: 1.3.0
- Proof protocol: unchanged 0.2.0

## Context

Package integrity did not directly answer whether an ordinary image held by the user was the same
file declared as a generated output. Manual role assignment was also easy to misread: marking an
image `input` records its role but cannot prove that it was generated or who created it.

## Decision

`proof-core` owns one image-to-package operation. It first completes all existing container,
Manifest, asset, and event-chain checks against one package instance. Only a valid package permits
the operation to stream a bounded regular non-symlink PNG/JPEG/WebP and compare its exact size and
SHA-256 with verified Manifest assets. The result distinguishes output match, non-output match,
absence, and invalid package.

Creation-output export is separate and reads only the creation session's recorded portable
workspace `output`. Rust reloads the workspace, revalidates the source bytes, writes a
same-directory temporary file, syncs it, and publishes without overwrite. Typed preload and IPC
use expiring operation-specific `image` and `image-output` references; Renderer never gains a
generic path, read, write, ZIP extraction, or native-module API. Main may create a bounded
metadata-free thumbnail after type/size validation, but SQLite stores neither thumbnails nor
original image bytes.

## Consequences

An unchanged renamed image can match, while any byte change does not. A successful result means
only that the selected bytes equal a declared `output` in a proof package whose internal integrity
passed. Protocol 0.2.0 still has no creator identity, authorship, originality, ownership, digital
signature, earliest-creation proof, or trusted time.
