#!/bin/bash
# Regression: isolated vis-network browser performance trial

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

artifact_dir="${GRAPH_VIS_TRIAL_ARTIFACT_DIR:-}"
if [ -z "$artifact_dir" ]; then
  artifact_dir="$(mktemp -d)"
fi
mkdir -p "$artifact_dir"

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1

playwright_node_path="$(
  npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"

chrome_executable="${GRAPH_VIS_TRIAL_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ]; then
  candidate="$(
    NODE_PATH="$playwright_node_path" node -e 'const { chromium } = require("playwright"); console.log(chromium.executablePath())'
  )"
  if [ -x "$candidate" ]; then
    chrome_executable="$candidate"
  elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  fi
fi

cd "$REPO_ROOT"
NODE_PATH="$playwright_node_path" \
GRAPH_VIS_TRIAL_ARTIFACT_DIR="$artifact_dir" \
GRAPH_VIS_TRIAL_CHROME_EXECUTABLE="$chrome_executable" \
node --import tsx tests/browser/graph-vis-network-trial.ts

test -f "$artifact_dir/vis-network-trial-results.json"
echo "PASS: vis-network performance trial ($artifact_dir/vis-network-trial-results.json)"
