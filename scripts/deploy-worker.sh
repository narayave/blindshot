#!/bin/sh
# Deploy the photo worker (worker/ + lib/) to Azure Functions. Azure installs the packages itself (Linux build).
#   scripts/deploy-worker.sh [function-app-name]
set -e
APP=${1:-blindshot-worker}
OUT=$(mktemp -d)
mkdir -p "$OUT/worker" "$OUT/lib"
cp worker/index.ts "$OUT/worker/"
cp worker/package.json worker/host.json "$OUT/"
cp lib/*.ts "$OUT/lib/"
cd "$OUT" && func azure functionapp publish "$APP" --javascript --build remote
