# Contribution constraints

Before modifying this repository, read `README.md`, `PROJECT_STATE.md`, and relevant files under `docs/`.

At the start of every task, restore repository context before editing: read the files above, run `git status --short`, `git branch --show-current`, `git remote -v`, and `git log -1 --oneline`, and confirm the repository root. If unrelated uncommitted changes exist, preserve them and stop modifying the affected repository.

- The open-source code must build and verify independently; basic functions must not require closed-source services.
- Do not add private official APIs, secrets, production addresses, or internal rules.
- Every protocol change updates schemas, protocol documentation, test vectors, and compatibility notes together.
- Use Rust 2024 Edition and retain Windows, Linux, and macOS compatibility.
- Use `std::path::Path` and `PathBuf` for paths; process large media as streams by default.
- Treat all external input as untrusted. ZIP handling must prevent path traversal, compression bombs, and symlink escapes.
- Do not present system time alone as trusted time proof or invent incompatible cryptographic protocols.
- Version 0.2 implements hashing and integrity verification only. Do not add creator signatures, identity claims, or trusted-time claims in this phase.
- When validation is required, run the real program or executable test path. A compile-only check is not a substitute. If the program cannot be run or any required test does not pass, report the result explicitly as `TEST FAILED`.
