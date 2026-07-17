#!/bin/bash
# Regression: offline graph ships graph-scoped search, not the old cockpit UI

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_searches_visible_nodes() {
    local tmp_dir html playwright_node_path
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    playwright_node_path="$(
        npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
    )"
    GRAPH_HTML_SEARCH_HTML="$html" NODE_PATH="$playwright_node_path" node "$REPO_ROOT/tests/browser/graph-html-search.mjs" \
        || fail "offline graph search should show, navigate, and open the expected result"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_searches_visible_nodes
    echo "PASS: graph HTML search regression coverage"
}

main "$@"
