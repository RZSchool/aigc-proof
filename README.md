# AIGC-Proof

Open protocol and Rust reference implementation for recording an AIGC creation workflow, sealing it into an unsigned proof package, and verifying package-internal integrity offline.

~~~text
Version: 0.2.0 WIP
Status: Ready for review
Assurance level: Internal Integrity
~~~

Version 0.2 does not contain a creator digital signature or trusted timestamp. A valid result means:

~~~text
Package internal integrity: valid
Creator identity: not verified
Digital signature: not present
Trusted timestamp: not present
Originality: not evaluated
~~~

It is not copyright registration, rights determination, originality certification, proof of ownership, or official verification. An attacker can construct an entirely new, internally consistent unsigned package.

## Offline workflow

~~~bash
aigc-proof init demo-workspace --project-name "Project Name"
aigc-proof add demo-workspace input.txt --role input
aigc-proof add demo-workspace output.txt --role output
aigc-proof record demo-workspace \
  --event-type generation \
  --payload-file generation-event.json
aigc-proof seal demo-workspace --output example.aigcproof
aigc-proof verify example.aigcproof
aigc-proof verify example.aigcproof --json verification-result.json
aigc-proof inspect example.aigcproof
aigc-proof inspect example.aigcproof --json
~~~

Roles are input, output, reference, license, and other. add copies bounded regular,
non-symlink files into the workspace and hashes them as streams. seal and persisted
verification reports use same-directory temporary files and never overwrite an existing
output. Relative output paths are supported. inspect reads metadata and explicitly does
not claim verification.

The CLI is fully offline and performs no upload. Pass prompts and parameters through payload JSON files instead of command-line text to reduce shell-history exposure.

## Public/private boundary

The public repository owns the protocol, Schemas, workspace model, SHA-256, RFC 8785 JCS, event chain, ZIP package, defensive reader, CLI, and offline verification. It has no dependency on aigc-proof-official.

Official identity, signing authority, registered keys, revocation, trusted time, risk controls, billing, and production operations are outside 0.2 and remain unimplemented.

## Build and test

Rust 1.85.0, rustfmt, and Clippy are pinned by rust-toolchain.toml.

~~~bash
cargo fmt --all --check
cargo check --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo doc --workspace --no-deps
scripts/smoke-test.sh
cargo metadata --format-version 1
cargo tree
~~~

A compile-only check is not an executable test. If the real CLI path cannot run, report TEST FAILED.

See [CLI](docs/CLI.md), [specification](docs/AIGC-PROOF-SPEC.md), [package format](docs/PACKAGE-FORMAT.md), [assurance levels](docs/ASSURANCE-LEVELS.md), [threat model](docs/THREAT-MODEL.md), and [compatibility](docs/COMPATIBILITY.md).

## License

Apache-2.0.
