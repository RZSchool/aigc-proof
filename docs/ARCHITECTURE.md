# Architecture

## Purpose

Describe the public component boundary.

## Current decision

```text
CLI / Desktop / WASM
        ↓
proof-core
        ↓
Schema + Package + Hash + Signature + Verification
```

The core and verification path will remain usable offline.

## Not decided

Concrete crate APIs, package reader design, and compatibility-layer details are not set.

## Next

Define the proof-core interfaces and package-validation flow.
