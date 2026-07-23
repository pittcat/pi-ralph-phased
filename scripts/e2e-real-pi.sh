#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
provider="${PI_E2E_PROVIDER:-deepseek}"
model="${PI_E2E_MODEL:-deepseek-v4-flash}"
timeout_seconds="${PI_E2E_TIMEOUT_SECONDS:-180}"
fixture="$repo_dir/test/e2e/phased-prompt.md"
output="$(mktemp "${TMPDIR:-/tmp}/pi-ralph-phased-e2e.XXXXXX.jsonl")"

if ! command -v pi >/dev/null 2>&1; then
  echo "FAIL: pi is not installed."
  exit 1
fi

prompt="$(<"$fixture")"
timeout "${timeout_seconds}s" pi \
  -e "$repo_dir/src/index.ts" \
  -p --mode json --no-session \
  --no-skills --no-context-files --no-builtin-tools \
  --tools ralph_stage_done \
  --provider "$provider" --model "$model" \
  "$prompt" >"$output"

if node "$repo_dir/test/e2e/verify-jsonl.mjs" "$output"; then
  rm -f "$output"
else
  echo "Pi JSONL retained for diagnosis: $output"
  exit 1
fi
