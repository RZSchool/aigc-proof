# Roadmap

```text
0.2 Internal Integrity
0.3 Creator Signature
0.4 Trusted Timestamp
0.5 C2PA Bridge
1.0 Stable Specification
```

Version 0.2 remains the frozen unsigned compatibility profile. Version 0.3 creator signatures are
complete under AP-031. Version 0.4 RFC 3161 trusted time is the AP-032 phase and does not
retroactively add assurance to 0.2/0.3 packages.

The desktop workbench has an independent application version. Workbench 0.7.0 is a local-first
Electron/React client of the 0.4.0 Rust engine, using `ProofHostApi` 1.6.0, fail-closed
native API 1.5.0 discovery, typed opaque references, bounded Main-owned jobs, a supervised
Utility-only napi-rs boundary, a reusable Node creation core, a loopback-only ComfyUI v0.27.0
adapter, exact no-clobber creation-output export, byte-for-byte verified-package output matching,
workspace-scoped explicit history restoration, and disposable SQLite application state. Its full workflow is one menu-free scrollable
page. Application releases do not advance protocol assurance. The
earlier Win32 preview was retired from primary use only after packaged replacement acceptance
succeeded.

Local COSE/Ed25519 signatures are the 0.3/AP-031 phase; explicit RFC 3161 acquisition and offline
verification are the 0.4/AP-032 phase. C2PA, official identity services, production KMS/HSM,
S3-backed services, and WASM remain separate reviewed phases and are not implied by Workbench 0.7.0.

## Rights Protection product track

Rights Protection is a separate planned product sequence and does not alter protocol versioning or
current assurance:

```text
RP-1 Rights Record
RP-2 Publication Record
RP-3 Similarity Detection
RP-4 Resilient Binding
RP-5 Monitoring and Case Operations
```

Its intended flow is `register -> publish -> detect -> preserve -> review -> export`. Exact hashes,
perceptual similarity, signatures, trusted time, publication observations, and watermarks remain
independent signals; none automatically establishes ownership, originality, authorization, or
infringement. The first planned MVP is local-only and user-driven. See
[Rights Protection Product Track](RIGHTS-PROTECTION-ROADMAP.md).
