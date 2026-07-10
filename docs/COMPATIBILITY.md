# Compatibility Notes

## 0.1 to 0.2

The retained schemas/v0.1 files are draft history and are not valid 0.2 artifacts.

Version 0.2 introduces the workspace workflow; Manifest tool/project/assets model; event sequence starting at 1; canonical UTC Z timestamps; structured assurance; stable error codes; exact stable ZIP entry order; and centralized defensive limits. The previous temporary hash/create CLI and files/event-chain draft model are incompatible and removed from public documentation.

Small packages may use ordinary ZIP records. ZIP64 is supported only when standard fields are insufficient; it is not forced for every package.

JSON Schema describes field structure and basic lexical constraints. It cannot express every cross-field, ordering, archive-metadata, or cross-platform path rule. Shared Rust validators are the execution layer and must not change the Schema field meanings.

The pinned zip crate interprets explicit Unix symbolic-link metadata and supports standard ZIP/ZIP64 reading. Because producer metadata varies, entries are never extracted and cross-platform compatibility remains a release gate.

Unsigned 0.2 packages must never be reinterpreted as signed, identity-verified, officially verified, or trusted-time evidence by later versions.
