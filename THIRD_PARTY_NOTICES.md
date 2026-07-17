# Third-party notices

AIGC-Proof is licensed under Apache-2.0. Its locked dependency graph includes third-party software under compatible open-source licenses. This notice is informational and does not replace the license text distributed by each dependency.

## Content Authenticity Initiative C2PA SDK

- Package: `c2pa` 0.89.3
- Reviewed source tag object/peeled commit: `c2pa-v0.89.3` / `4b9caf5398ca0e0106f989306daa00a9955504ea` / `e2c90ec7f1fd0a3c90adfaf93107e19abd5383b8`
- crates.io checksum: `033a638e07c1c6194f0e0964e2cf0c1848109b25cc77d7070a9417e59005b010`
- License: Apache-2.0 OR MIT
- Project: <https://github.com/contentauth/c2pa-rs>

The product builds this SDK with default features disabled and only the `file_io` and `rust_native_crypto` features. The AP-033 `c2pa` 0.85.0 corpus remains a read-compatibility fixture only. `c2patool` and C2PA Attacks are independent test/reference tools and are not included in the Workbench package.

## Desktop runtime

The packaged desktop runtime includes Electron and its Chromium/Node.js components, React, Zod, and their locked transitive dependencies under their respective licenses. Electron's generated runtime license files remain in the delivered folder. Exact package versions are recorded in `apps/desktop/pnpm-lock.yaml` and the package metadata.

## External components not distributed

ComfyUI, Python, model weights, checkpoints, custom nodes, C2PA test certificates/private keys, trust profiles, official corpora, and reference tools are not distributed in the Workbench package. ComfyUI remains an external user-managed GPL-3.0-only component.
