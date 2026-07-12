# Roadmap

~~~text
0.2 Internal Integrity
0.3 Creator Signature
0.4 Trusted Timestamp
0.5 C2PA Bridge
1.0 Stable Specification
~~~

Version 0.2 is Ready for review after its fixed-toolchain checks, real CLI acceptance, tamper
detection, and malicious-package tests passed. It remains pre-release until review and release
work are completed. Later stages require separate protocol review and do not retroactively add
assurance to unsigned 0.2 packages.

The desktop workbench has an independent application version. Workbench 0.1.1 is an offline
Electron/React client of the unchanged 0.2.0 Rust engine, using a typed preload/IPC boundary,
napi-rs, and disposable SQLite application state. Application releases do not advance protocol
assurance. The earlier Win32 preview was retired from primary use only after packaged replacement
acceptance succeeded.

COSE/signatures, official identity services, RFC 3161, C2PA, S3-backed services, and WASM remain
future reviewed phases; they are not bundled into workbench 0.1.1.

## Rights Protection product track

Rights Protection is a separate planned product sequence and does not alter protocol versioning or
current assurance:

~~~text
RP-1 Rights Record
RP-2 Publication Record
RP-3 Similarity Detection
RP-4 Resilient Binding
RP-5 Monitoring and Case Operations
~~~

Its intended flow is `register -> publish -> detect -> preserve -> review -> export`. Exact hashes,
perceptual similarity, signatures, trusted time, publication observations, and watermarks remain
independent signals; none automatically establishes ownership, originality, authorization, or
infringement. The first planned MVP is local-only and user-driven. See
[Rights Protection Product Track](RIGHTS-PROTECTION-ROADMAP.md).
