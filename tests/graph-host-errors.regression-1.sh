#!/bin/bash
# Regression: graph hosts recover from shared preparation and offline environment failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
  || fail "graph-engine build should succeed before host error browser regression"
build_graph_html_fixture "$tmp_dir"

chrome_executable="$(graph_browser_chrome_executable "${GRAPH_HOST_ERROR_CHROME_EXECUTABLE:-}")"
playwright_node_path="$(graph_browser_playwright_node_path)"

cd "$REPO_ROOT"
GRAPH_HOST_ERROR_OFFLINE_HTML="$tmp_dir/wiki/knowledge-graph.html" \
GRAPH_HOST_ERROR_CHROME_EXECUTABLE="$chrome_executable" \
NODE_PATH="$playwright_node_path" \
node tests/browser/graph-host-errors.mjs

echo "PASS: graph host error browser regression"
