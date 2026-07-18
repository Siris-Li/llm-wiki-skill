#!/bin/bash
# Regression: offline oriental atlas presents a real first view, recommended start, and reading result.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_oriental_design_browser_contract() {
    local tmp_dir html playwright_node_path
    tmp_dir="$(mktemp -d)"

    mkdir -p "$tmp_dir/wiki"
    jq '.learning = {
      entry: {
        recommended_start_node_id: "A",
        recommended_start_reason: "community_hub",
        default_mode: "global"
      }
    }' "$REPO_ROOT/$GRAPH_HTML_BASIC/wiki/graph-data.json" > "$tmp_dir/wiki/graph-data.json"
    ensure_graph_engine_dist
    bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed for oriental browser acceptance"
    html="$tmp_dir/wiki/knowledge-graph.html"

    playwright_node_path="$(
        npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
    )"
    GRAPH_ORIENTAL_CONTRACT_HTML="$html" NODE_PATH="$playwright_node_path" \
        node "$REPO_ROOT/tests/browser/graph-html-oriental-design-contract.mjs" \
        || fail "oriental design browser contract should pass"

    rm -rf "$tmp_dir"
}

main() {
    npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
        || fail "graph-engine build should succeed before oriental browser acceptance"
    test_oriental_design_browser_contract
    echo "PASS: oriental design contract regression coverage"
}

main "$@"
