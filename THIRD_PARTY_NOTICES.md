# Third-party notices

AIGC-Proof is licensed under Apache-2.0. Its locked dependency graph includes third-party software under compatible open-source licenses. This notice is informational and does not replace the license text distributed by each dependency.

## Content Authenticity Initiative C2PA SDK

- Package: `c2pa` 0.85.0
- Reviewed source tag/commit: `c2pa-v0.85.0` / `3f40cdd22b60bf955d531b0301604e3f257e0a19`
- License: Apache-2.0 OR MIT
- Project: <https://github.com/contentauth/c2pa-rs>

The product builds this SDK with default features disabled and only the `file_io` and `rust_native_crypto` features. `c2patool` and C2PA Attacks are independent test/reference tools and are not included in the Workbench package.

## Desktop runtime

The packaged desktop runtime includes Electron and its Chromium/Node.js components, React, Zod, and their locked transitive dependencies under their respective licenses. Electron's generated runtime license files remain in the delivered folder. Exact package versions are recorded in `apps/desktop/pnpm-lock.yaml` and the package metadata.

## External components not distributed

ComfyUI, Python, model weights, checkpoints, custom nodes, C2PA test certificates/private keys, trust profiles, official corpora, and reference tools are not distributed in the Workbench package. ComfyUI remains an external user-managed GPL-3.0-only component.
