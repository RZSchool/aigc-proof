# Signature Profile

## Version 0.2 status

No digital signature exists in 0.2. The manifest, file digests, and event chain are not bound to a creator key or external authority. Implementations must not label a 0.2 integrity result as signed, identity-verified, certified, notarized, or trusted-time proof.

Ed25519, COSE_Sign1, key discovery, revocation, and external witnessing remain future design topics. A later signature profile must be versioned, reviewed, and accompanied by interoperable test vectors; it must not silently reinterpret unsigned 0.2 packages.
