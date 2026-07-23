#!/usr/bin/env bash
set -euo pipefail

# Scaffold smoke: proves only that Pi can load the extension entrypoint.
# U11 must add an assertion for the short-prompt pass-through output and define
# how model credentials are supplied without embedding secrets in this script.
if ! command -v pi >/dev/null 2>&1; then
  echo "pi is required for the smoke test" >&2
  exit 127
fi

pi -e ./src/index.ts --help >/dev/null
