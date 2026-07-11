# CLI 0.2

## Workflow

~~~text
init -> add -> record -> seal -> verify -> inspect
~~~

~~~bash
aigc-proof init <workspace> --project-name "Project Name"
aigc-proof add <workspace> <file> --role input
aigc-proof record <workspace> --event-type generation --payload-file event.json
aigc-proof seal <workspace> --output proof.aigcproof
aigc-proof verify proof.aigcproof
aigc-proof verify proof.aigcproof --json result.json
aigc-proof inspect proof.aigcproof
aigc-proof inspect proof.aigcproof --json
~~~

init refuses an existing path. add accepts only a portable-named regular non-symlink file,
copies and hashes it through configured byte bounds, and never stores its external absolute
path. record accepts a size-bounded JSON object payload file. seal accepts relative or absolute
outputs, creates a new output through a same-directory temporary file, and never overwrites.
verify emits a Schema-checked report and exits 0 for valid, 1 for invalid package/protocol
content, and 2 for an operational error. A `--json` report is also persisted through a
same-directory temporary file without overwrite. inspect applies container and Manifest safety
checks but does not verify asset or event integrity.

There is no public hash, create, pack, or build-proof command in the 0.2 stable workflow.
