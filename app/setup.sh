#!/usr/bin/env bash
# ornata-macos (app) — obtain the native addon.
#
# The Electron app reuses the addon from the sibling cli/ folder. This thin
# wrapper just runs cli/setup.sh, which extracts addon.node out of the installed
# "Razer macOS.app". We do NOT ship that binary (it's GPL and device-specific).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CLI_SETUP="$HERE/../cli/setup.sh"

if [ ! -x "$CLI_SETUP" ]; then
  echo "Could not find $CLI_SETUP" >&2
  echo "Run the CLI setup directly: (cd ../cli && ./setup.sh)" >&2
  exit 1
fi

# Pass through an optional path to the Razer app, e.g.:
#   ./setup.sh "/Applications/Razer macOS.app"
exec "$CLI_SETUP" "$@"
