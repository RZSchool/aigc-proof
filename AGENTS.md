# Contribution constraints

Before modifying this repository, read `README.md`, `PROJECT_STATE.md`, and relevant files under `docs/`.

- The open-source code must build and verify independently; basic functions must not require closed-source services.
- Do not add private official APIs, secrets, production addresses, or internal rules.
- Every protocol change updates schemas, protocol documentation, test vectors, and compatibility notes together.
- Use Rust 2024 Edition and retain Windows, Linux, and macOS compatibility.
- Use `std::path::Path` and `PathBuf` for paths; process large media as streams by default.
- Treat all external input as untrusted. ZIP handling must prevent path traversal, compression bombs, and symlink escapes.
- Do not present system time alone as trusted time proof or invent incompatible cryptographic protocols.
- Phase 0 is scaffold-only: do not implement cryptographic logic yet.
