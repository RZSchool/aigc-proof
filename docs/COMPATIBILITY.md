# Compatibility Notes

## Protocol 0.2 to 0.4

Protocol 0.3 preserves the 0.2 asset, event-chain, canonical JSON, timestamp, portable-path, ZIP/ZIP64, and no-clobber rules. It adds required creator-signature metadata and two security entries. Existing 0.2 packages remain valid unsigned Internal Integrity packages and are never reinterpreted as signed or identity-verified.

Protocol 0.4 preserves those rules and adds a creator-signed timestamp plan plus an optional final RFC 3161 response. The verifier dispatches Schemas by declared version and accepts 0.2, 0.3, and 0.4. A 0.3 package cannot be timestamped in place; it must receive a new contemporary 0.4 signature. The CLI exposes `--legacy-unsigned-v02` only for explicit compatibility output.

Display labels are new untrusted protocol text. They require NFC and strict length/control checks; a non-ASCII label produces a visual-confusable review warning. A label is never an authority identifier.

## Workbench 0.7.0 matrix

| Layer | Version | Compatibility behavior |
|---|---:|---|
| Workbench | 0.7.0 | Adds explicit TSA snapshot import, consented acquisition, cancellation, and offline trusted-time UI |
| `ProofHostApi` | 1.6.0 | Adds narrow timestamp profile/request/cancel operations without a generic network surface |
| Native API | 1.5.0 | Adds strict profile validation and offline request/attach/verify operations |
| Native engine | 0.4.0 | Current signed and timestamp-capable engine; verifies legacy 0.2/0.3 |
| Proof protocol | 0.4.0 | Current format; supported list is 0.2.0, 0.3.0, and 0.4.0 |
| Creation core | 1.0.0 | Unchanged host-independent local creation lifecycle |
| ComfyUI profile | 0.27.0 | Existing external local installation; never bundled |

Unknown major versions, missing required capabilities, inconsistent limits, malformed handshakes, or a missing current protocol fail closed before proof IPC registration. Portable workspaces, packages, and reports remain authoritative; SQLite remains disposable application metadata.

Windows x64 is the packaged-workbench target. Windows and Linux are required core regression platforms for this stage. macOS remains a compatibility target but is not claimed as executed without evidence.

Cargo.lock is committed. Direct dependencies are exact. `x509-tsp` is pinned to 0.1.0, `sigstore-tsa` to 0.8.0, and the idna/ICU4X transitive line remains pinned to Rust-1.85-compatible releases for AP-032.
