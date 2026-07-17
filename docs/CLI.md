# CLI 1.0

## Signed workflow

~~~text
key create -> init -> add -> record / optional C2PA observation -> seal --confirm-signature -> optional timestamp -> offline verify / official-identity -> inspect
~~~

~~~bash
aigc-proof key status
aigc-proof key create --display-label "Local creator"
aigc-proof key rotate --display-label "Replacement label" --confirm
aigc-proof key export-public --output creator-key.cbor
aigc-proof key disable --confirm

aigc-proof init <workspace> --project-name "Project Name"
aigc-proof add <workspace> <file> --role input
aigc-proof record <workspace> --event-type generation --payload-file event.json
aigc-proof timestamp profile tsa-profile.json
aigc-proof seal <workspace> --output proof.aigcproof --confirm-signature \
  --tsa-profile tsa-profile.json --timestamp-policy any
aigc-proof timestamp request proof.aigcproof --tsa-profile tsa-profile.json \
  --output request.tsq
# Send request.tsq only through an independently reviewed HTTPS client.
aigc-proof timestamp attach proof.aigcproof --response response.tsr \
  --tsa-profile tsa-profile.json --output timestamped.aigcproof
aigc-proof verify timestamped.aigcproof --tsa-profile tsa-profile.json \
  --json result.json
aigc-proof inspect proof.aigcproof --json

aigc-proof c2pa profile c2pa-trust.json
aigc-proof c2pa inspect --asset signed.png \
  --trust-profile c2pa-trust.json
aigc-proof c2pa observe --workspace <workspace> --asset-id <uuid> \
  --sidecar explicit.c2pa --trust-profile c2pa-trust.json

aigc-proof official-identity \
  --attestation official-attestation-v1.cose \
  --issuer-trust official-issuer-trust-v1.json \
  --status official-status-snapshot-v1.cose \
  --creator-key-fingerprint sha256:<64-lowercase-hex> \
  --purpose creator_identity --at <unix-seconds>
~~~

The display label is self-asserted. Create refuses an existing record; rotation and disable require explicit confirmation. The private key is never exported. If the operating-system credential store is unavailable, signing fails closed.

`seal` creates a signed protocol 1.0 package whether or not a TSA profile is supplied. Passing `--tsa-profile` predeclares the bound timestamp plan before signing and requires `--timestamp-policy` to be an allowed OID or the explicit `any` marker. `--legacy-unsigned-v02` remains an explicit compatibility-test mode and conflicts with signature confirmation. There is no writer for historical 0.3/0.4/0.5 packages.

The CLI itself never opens a network connection. `timestamp request` writes the exact RFC 3161 DER request and prints the endpoint, SHA-256 message imprint, 128-bit nonce, requested policy, and profile digest disclosure. `timestamp attach` accepts at most 1 MiB, verifies it before publishing a new package, and never overwrites. Ordinary `verify` remains offline; trusted time can become `valid_trusted` only when the exact bound TSA snapshot is supplied.

`c2pa profile` validates and summarizes one explicit portable signer/TSA trust profile. `c2pa inspect` reads a JPEG, PNG, or WebP with an embedded manifest or an explicitly named lowercase local `.c2pa` sidecar. `c2pa observe` additionally requires an existing workspace image asset, rechecks its exact SHA-256, and records only a normalized digest-bound event. These commands never fetch a remote manifest, soft binding, OCSP result, or trust root. Claim v2 is current and claim v1 is read-only compatibility; later claims and MP4/PDF are rejected.

`official-identity` reads at most 64 KiB from each explicit local attestation/trust/status artifact and never contacts an official service. The caller supplies the creator fingerprint, purpose, explicit time and optional rollback/freshness policy. Exit 0 is reserved for `valid_trusted`; all other well-formed assurance states are printed and exit 1.

All file operations are bounded and no-clobber. `verify` exits 0 for valid, 1 for invalid content, and 2 for an operational error. `inspect` reads bounded metadata but makes no signature, integrity, or trusted-time claim. The CLI performs no upload.
