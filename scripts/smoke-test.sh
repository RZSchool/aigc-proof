#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

printf '%s\n' 'input' >"$work/input.txt"
printf '%s\n' 'output' >"$work/output.txt"
printf '%s\n' '{"model":"demo-model","operation":"text-transformation","note":"AIGC-Proof 0.2 CLI verification demo"}' >"$work/generation-event.json"

cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- init "$work/demo-workspace" \
  --project-name "AIGC-Proof 0.2 demo"
cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- add "$work/demo-workspace" \
  "$work/input.txt" --role input
cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- add "$work/demo-workspace" \
  "$work/output.txt" --role output
cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- record "$work/demo-workspace" \
  --event-type generation --payload-file "$work/generation-event.json"
cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- seal "$work/demo-workspace" \
  --output "$work/demo.aigcproof"
cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- verify "$work/demo.aigcproof"
cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- verify "$work/demo.aigcproof" \
  --json "$work/verification-result.json"
cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- inspect "$work/demo.aigcproof"
cargo run -p proof-cli --manifest-path "$root/Cargo.toml" -- inspect "$work/demo.aigcproof" --json

python3 - "$work/demo.aigcproof" "$work/verification-result.json" <<'PY'
import json
import pathlib
import sys

package = pathlib.Path(sys.argv[1])
report_path = pathlib.Path(sys.argv[2])
assert package.is_file(), package
assert report_path.is_file(), report_path
with report_path.open(encoding="utf-8") as handle:
    report = json.load(handle)
assert report["status"] == "valid", report
assert report["assurance"] == {
    "internal_integrity": "valid",
    "creator_identity": "not_verified",
    "digital_signature": "not_present",
    "trusted_time": "not_present",
    "originality": "not_evaluated",
}, report
PY
