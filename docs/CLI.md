# CLI 0.3

## Signed workflow

~~~text
key create -> init -> add -> record -> seal --confirm-signature -> verify -> inspect
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
aigc-proof seal <workspace> --output proof.aigcproof --confirm-signature
aigc-proof verify proof.aigcproof --json result.json
aigc-proof inspect proof.aigcproof --json
~~~

The display label is self-asserted. Create refuses an existing record; rotation and disable require explicit confirmation. The private key is never exported. If the operating-system credential store is unavailable, signing fails closed.

`seal` creates signed protocol 0.3 by default and requires `--confirm-signature`. `--legacy-unsigned-v02` is an explicit compatibility mode and conflicts with signature confirmation.

All file operations are bounded and no-clobber. `verify` exits 0 for valid, 1 for invalid content, and 2 for an operational error. `inspect` reads bounded metadata but makes no signature or integrity claim. The CLI performs no upload.
