#!/bin/bash
# Regression: phase 6 offline HTML keeps building every fixture and follows the current Sigma host journey.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

tmp_dir="$(mktemp -d)"
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
    || fail "graph-engine IIFE build should succeed before phase 6 offline regression"

for fixture in graph-interactive-basic graph-interactive-dense graph-interactive-multicomm; do
    cp -R "$REPO_ROOT/tests/fixtures/$fixture" "$tmp_dir/$fixture"
    bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir/$fixture" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on $fixture"
    html="$tmp_dir/$fixture/wiki/knowledge-graph.html"
    assert_file_exists "$html"
    [ -s "$html" ] || fail "$fixture generated knowledge-graph.html should be non-empty"
    assert_single_file_engine_output "$tmp_dir/$fixture/wiki"
done

playwright_node_path="$(
    npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"

chrome_executable="${GRAPH_OFFLINE_PHASE_6_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

GRAPH_OFFLINE_ACCEPTANCE_HTML="$tmp_dir/graph-interactive-basic/wiki/knowledge-graph.html" \
GRAPH_OFFLINE_ACCEPTANCE_CHROME_EXECUTABLE="$chrome_executable" \
NODE_PATH="$playwright_node_path" \
node "$REPO_ROOT/tests/browser/graph-offline-host-acceptance.mjs" \
    || fail "phase 6 offline graph browser regression should pass"

echo "PASS: phase 6 offline graph regression"
