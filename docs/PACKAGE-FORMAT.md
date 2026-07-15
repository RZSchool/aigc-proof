# .aigcproof Package Format 0.4

## ZIP and entry order

An `.aigcproof` file is a standard ZIP archive with ZIP64 support. It does not sign the whole ZIP byte stream; signature and integrity checks cover canonical protocol content and declared entry bytes.

Unsigned legacy 0.2 order:

~~~text
manifest.json
assets sorted lexicographically by package_path
events.json
~~~

Signed 0.3 order:

~~~text
manifest.json
assets sorted lexicographically by package_path
events.json
security/keys/<key-fingerprint>.cbor
security/signatures/creator.cose
~~~

Signed 0.4 order before timestamp acquisition is the same as 0.3. When acquisition succeeds, one final entry is appended:

~~~text
manifest.json
assets sorted lexicographically by package_path
events.json
security/keys/<key-fingerprint>.cbor
security/signatures/creator.cose
security/timestamps/<signature-id>.tsr
~~~

Timestamp attachment always writes a new no-clobber output. `manifest.json`, the public key, and the exact tagged creator `COSE_Sign1` bytes are copied unchanged; only the predeclared bounded DER response is added. A 0.3 package cannot be timestamped in place and must be signed as a contemporary 0.4 package first.

Each declared asset and security entry must exist exactly once. Missing, undeclared, duplicate, case-conflicting, or reordered entries are invalid. Package paths use UTF-8 and forward slashes and reject absolute, UNC, drive, backslash, NUL, dot, parent, directory, control, Windows-forbidden, reserved-device, or trailing-dot/space forms.

## Security-entry limits

The default maximum public `COSE_Key` size is 256 bytes, the default maximum `COSE_Sign1` size is 1,024 bytes, and the timestamp response cap is 1 MiB. All remain subject to the general entry and total-size limits.

## Default verification limits

| Field | Default |
|---|---:|
| `max_package_bytes` | 2 GiB |
| `max_entries` | 1,024 |
| `max_manifest_bytes` | 1 MiB |
| `max_event_bytes` | 16 MiB |
| `max_creator_key_bytes` | 256 B |
| `max_creator_signature_bytes` | 1 KiB |
| `max_timestamp_response_bytes` | 1 MiB |
| `max_total_uncompressed_bytes` | 2 GiB |
| `max_single_entry_bytes` | 512 MiB |
| `max_compression_ratio` | 100:1 |

The verifier checks EOCD/ZIP64 declared counts before trusting the ZIP library map, checks declared metadata before decompression, then streams actual bytes through hard bounds. Only Stored and Deflated regular files are accepted. Encrypted entries, links, directories, special files, unsafe names, and unsupported compression are rejected. Entries are never extracted.
