# Compatibility Notes

## Protocol 0.2 to 0.3

Protocol 0.3 preserves the 0.2 asset, event-chain, canonical JSON, timestamp, portable-path, ZIP/ZIP64, and no-clobber rules. It adds required creator-signature metadata and two security entries. Existing 0.2 packages remain valid unsigned Internal Integrity packages and are never reinterpreted as signed or identity-verified.

The verifier dispatches Schemas by declared version and accepts both 0.2 and 0.3. New normal workspaces use 0.3. The CLI exposes `--legacy-unsigned-v02` only for explicit compatibility output.

Display labels are new untrusted protocol text. They require NFC and strict length/control checks; a non-ASCII label produces a visual-confusable review warning. A label is never an authority identifier.

## Workbench 0.6.0 matrix

| Layer | Version | Compatibility behavior |
|---|---:|---|
| Workbench | 0.6.0 | Local signer management, explicit signing consent, signed verification UI |
| `ProofHostApi` | 1.5.0 | Adds narrow signer status/create/rotate/disable operations and signature confirmation |
| Native API | 1.4.0 | Adds signer operations and signed seal while preserving reviewed 1.3 operations |
| Native engine | 0.3.0 | Current signed engine; verifies legacy 0.2 |
| Proof protocol | 0.3.0 | Current signed format; supported list is 0.2.0 and 0.3.0 |
| Creation core | 1.0.0 | Unchanged host-independent local creation lifecycle |
| ComfyUI profile | 0.27.0 | Existing external local installation; never bundled |

Unknown major versions, missing required capabilities, inconsistent limits, malformed handshakes, or a missing current protocol fail closed before proof IPC registration. Portable workspaces, packages, and reports remain authoritative; SQLite remains disposable application metadata.

Windows x64 is the packaged-workbench target. Windows and Linux are required core regression platforms for this stage. macOS remains a compatibility target but is not claimed as executed without evidence.

Cargo.lock is committed. Direct dependencies are exact. The idna/ICU4X transitive line remains pinned to Rust-1.85-compatible releases for AP-031.
