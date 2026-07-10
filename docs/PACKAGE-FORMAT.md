# .aigcproof Package Format 0.2

## ZIP and ZIP64

An .aigcproof file is a standard ZIP archive. Readers and writers support ZIP64, but small packages are not forced to emit ZIP64 records. The writer requests ZIP64 entry fields when an entry requires them; the ZIP library handles container-level ZIP64 structures when limits require them.

The protocol does not sign the whole ZIP byte stream, and a whole-file ZIP SHA-256 is not the sole internal-integrity mechanism.

## Stable entry order

~~~text
manifest.json
assets sorted lexicographically by package_path
events.json
~~~

Every Manifest asset must have exactly one matching regular-file entry. Undeclared entries, missing entries, duplicate names, and case-conflicting names are invalid.

Package paths use UTF-8 and forward slashes. Absolute, UNC, drive-prefixed, backslash, NUL, empty, dot, parent, and directory paths are forbidden.

## Default VerificationLimits

| Field | Default |
|---|---:|
| max_package_bytes | 2 GiB |
| max_entries | 1,024 |
| max_manifest_bytes | 1 MiB |
| max_event_bytes | 16 MiB |
| max_total_uncompressed_bytes | 2 GiB |
| max_single_entry_bytes | 512 MiB |
| max_compression_ratio | 100:1 |

Declared metadata is checked before decompression. Actual bytes and digests are checked while streaming. Only Stored and Deflated regular-file entries are accepted. Encrypted entries, explicit symbolic links, directories, special entries, unsafe names, and unsupported compression are rejected.

ZIP platform attributes are not equally expressive across producers. The verifier rejects entries identified as symbolic links and never extracts any entry, so a package path is never used as a filesystem write target. This constraint and library compatibility require real cross-platform testing.
