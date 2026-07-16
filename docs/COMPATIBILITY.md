# Compatibility Notes

## Protocol 0.2 to 0.5

Protocol 0.3 preserves the 0.2 asset, event-chain, canonical JSON, timestamp, portable-path, ZIP/ZIP64, and no-clobber rules. It adds required creator-signature metadata and two security entries. Existing 0.2 packages remain valid unsigned Internal Integrity packages and are never reinterpreted as signed or identity-verified.

Protocol 0.4 preserves those rules and adds a creator-signed timestamp plan plus an optional final RFC 3161 response. The verifier dispatches Schemas by declared version and accepts 0.2, 0.3, and 0.4. A 0.3 package cannot be timestamped in place; it must receive a new contemporary 0.4 signature. The CLI exposes `--legacy-unsigned-v02` only for explicit compatibility output.

Protocol 0.5 preserves the 0.4 security format and adds a strictly normalized `c2pa_observation` event plus separate report evidence. The verifier dispatches Schemas by declared version and accepts 0.2 through 0.5. A 0.2/0.3/0.4 package is never reinterpreted as having C2PA evidence, and an existing package is not mutated to add an observation.

Display labels are new untrusted protocol text. They require NFC and strict length/control checks; a non-ASCII label produces a visual-confusable review warning. A label is never an authority identifier.

## Workbench 0.8.0 matrix

| Layer | Version | Compatibility behavior |
|---|---:|---|
| Workbench | 0.8.0 | Adds explicit offline C2PA trust import, image/sidecar inspection, observation creation, and a separate evidence panel |
| `ProofHostApi` | 1.7.0 | Adds narrow C2PA profile/image/sidecar/inspection/observation operations without a generic network or parser surface |
| Native API | 1.6.0 | Adds strict C2PA profile validation and offline inspection/observation operations |
| Native engine | 0.5.0 | Current signed, timestamp-capable, C2PA-observation engine; verifies legacy 0.2/0.3/0.4 |
| Proof protocol | 0.5.0 | Current format; supported list is 0.2.0, 0.3.0, 0.4.0, and 0.5.0 |
| C2PA SDK | 0.85.0 | Exact minimal `file_io` + `rust_native_crypto` build; default HTTP, remote fetch, and OpenSSL are disabled |
| Creation core | 1.0.0 | Unchanged host-independent local creation lifecycle |
| ComfyUI profile | 0.27.0 | Existing external local installation; never bundled |

Unknown major versions, missing required capabilities, inconsistent limits, malformed handshakes, or a missing current protocol fail closed before proof IPC registration. Portable workspaces, packages, and reports remain authoritative; SQLite remains disposable application metadata.

Windows x64 is the packaged-workbench target. Windows and Linux are required core regression platforms for this stage. macOS remains a compatibility target but is not claimed as executed without evidence.

Cargo.lock is committed. Direct dependencies are exact. `x509-tsp` is pinned to 0.1.0, `sigstore-tsa` to 0.8.0, and `c2pa` to 0.85.0. Protocol 0.5 pins Rust 1.88.0 because that is the reviewed C2PA SDK MSRV; Rust 1.85.0 is intentionally insufficient.

C2PA compatibility is claim v2 plus v1 read-only, JPEG/PNG/WebP only, and embedded or explicitly selected local lowercase `.c2pa` sidecars. Claim versions later than 2, MP4/PDF, remote manifests, automatic sidecar discovery, soft bindings, and standalone production signing are fail-closed unsupported states.
