#!/usr/bin/env bash
# AI Provider Stability Test — thin shell wrapper
#
# Usage:
#   npm run test:ai                  # full run with snapshots on failure
#   AI_SMOKE_NO_CAPTURE=1 npm run test:ai  # skip snapshot capture
#   AI_SMOKE_DIR=/path/to/dir npm run test:ai  # custom report dir
set -euo pipefail
cd "$(dirname "$0")/.."
exec node native/tests/ai-provider-smoke.cjs "$@"
