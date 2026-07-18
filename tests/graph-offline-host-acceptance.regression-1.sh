#!/bin/bash
# Regression: offline single-file graph completes its normal browser journey without network access.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
  || fail "graph-engine build should succeed before offline host acceptance"
build_graph_html_fixture "$tmp_dir"

chrome_executable="${GRAPH_OFFLINE_ACCEPTANCE_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

playwright_node_path="$(
  npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"

cd "$REPO_ROOT"
GRAPH_OFFLINE_ACCEPTANCE_HTML="$tmp_dir/wiki/knowledge-graph.html" \
GRAPH_OFFLINE_ACCEPTANCE_CHROME_EXECUTABLE="$chrome_executable" \
NODE_PATH="$playwright_node_path" \
node tests/browser/graph-offline-host-acceptance.mjs

echo "PASS: offline host browser acceptance"
