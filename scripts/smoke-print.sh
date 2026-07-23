#!/usr/bin/env bash
set -euo pipefail

# This smoke test only proves that an installed Pi can load the extension.
# It deliberately does not invoke a model or require credentials.
if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi is not installed; real-Pi extension-load smoke was not run."
  exit 0
fi

pi -e ./src/index.ts --help >/dev/null
echo "PASS: pi loaded ./src/index.ts and returned --help successfully."
