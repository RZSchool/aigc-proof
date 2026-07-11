# RFC 8785 JCS vector

The basic vector places `a` before `z` and hashes the exact canonical object bytes without
a trailing line ending. The `rfc8785-*` vectors reproduce the RFC 8785 Section 3.2
primitive-serialization and UTF-16 property-order examples, covering number rounding,
escaping, Unicode output, and non-BMP key ordering.
