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

The desktop workbench has an independent application version. Workbench 0.1.0 is an offline
Electron/React client of the unchanged 0.2.0 Rust engine, using a typed preload/IPC boundary,
napi-rs, and disposable SQLite application state. Application releases do not advance protocol
assurance. The earlier Win32 preview was retired from primary use only after packaged replacement
acceptance succeeded.

COSE/signatures, official identity services, RFC 3161, C2PA, S3-backed services, and WASM remain
future reviewed phases; they are not bundled into workbench 0.1.0.
