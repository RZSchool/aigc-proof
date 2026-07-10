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

init refuses an existing path. add accepts only a regular non-symlink file, copies and hashes it as a stream, and never stores its external absolute path. record accepts a JSON object payload file. seal creates a new output through a same-directory temporary file and never overwrites. verify emits a Schema-checked report and exits 0 for valid, 1 for invalid, and 2 for operational error. inspect reads metadata without verifying asset or event integrity.

There is no public hash, create, pack, or build-proof command in the 0.2 stable workflow.
