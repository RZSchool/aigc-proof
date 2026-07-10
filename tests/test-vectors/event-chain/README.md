# First event hash vector

The first event has sequence 1 and previous_event_hash null. Exclude event_hash, canonicalize the remaining object with RFC 8785 JCS, and hash the exact canonical bytes without a trailing line ending.
