# CLI 0.4

## Signed workflow

~~~text
key create -> init -> add -> record -> seal --confirm-signature -> optional timestamp -> offline verify -> inspect
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
~~~

The display label is self-asserted. Create refuses an existing record; rotation and disable require explicit confirmation. The private key is never exported. If the operating-system credential store is unavailable, signing fails closed.

`seal` creates signed protocol 0.3 when no TSA profile is supplied. Passing `--tsa-profile` creates protocol 0.4, predeclares the bound timestamp plan before signing, and requires `--timestamp-policy` to be an allowed OID or the explicit `any` marker. `--legacy-unsigned-v02` remains an explicit compatibility mode and conflicts with signature confirmation.

The CLI itself never opens a network connection. `timestamp request` writes the exact RFC 3161 DER request and prints the endpoint, SHA-256 message imprint, 128-bit nonce, requested policy, and profile digest disclosure. `timestamp attach` accepts at most 1 MiB, verifies it before publishing a new package, and never overwrites. Ordinary `verify` remains offline; trusted time can become `valid_trusted` only when the exact bound TSA snapshot is supplied.

All file operations are bounded and no-clobber. `verify` exits 0 for valid, 1 for invalid content, and 2 for an operational error. `inspect` reads bounded metadata but makes no signature, integrity, or trusted-time claim. The CLI performs no upload.
