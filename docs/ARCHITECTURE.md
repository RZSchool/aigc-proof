# Architecture

## Offline component flow

~~~text
init -> add -> record -> seal -> verify -> inspect
                   |
                   v
                proof-cli
                   |
                   v
                proof-core
      workspace / hash / JCS / events / ZIP / verifier
                   |
                   v
               proof-schema
          types / strict JSON / Schema / semantics
~~~

The workspace is mutable local staging data. Asset copy and both seal hashing passes are
streamed through hard byte bounds, and workspace asset directories and files are rechecked
against symbolic links. seal creates a new immutable-by-convention package path and refuses
overwrite. The package writer precomputes and validates asset metadata, writes stable entry
order, flushes and syncs a same-directory temporary file, self-verifies it, confirms the
destination remains absent, and persists without clobbering.

The verifier never extracts entries. Before constructing the ZIP reader it reads the bounded
EOCD/ZIP64 records to enforce the declared entry count and detect names silently collapsed by
the pinned ZIP library. It then performs container safety, Manifest, assets, and event-chain
stages. Container or Manifest failures may stop dependent stages; asset and event stages
collect multiple errors when safe.

JSON Schema expresses portable structure. Shared Rust validation enforces strict time, lowercase digests, stable sorting, cross-field rules, path traversal defense, case conflicts, ZIP metadata limits, and streaming byte checks. Rust is the execution layer but does not redefine public Schema field meanings.

The public workspace has no dependency on private official code or services.
