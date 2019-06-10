#!/usr/bin/env bash

set -eo pipefail

if [ -z "$EXPONENT_TOOLS_DIR" ]; then
  EXPONENT_TOOLS_DIR="${SRCROOT}/../tools"
fi

source ${EXPONENT_TOOLS_DIR}/source-login-scripts.sh
${EXPONENT_TOOLS_DIR}/expotools/bin/expotools.js ios-cleanup-dynamic-macros --configuration ${CONFIGURATION}
