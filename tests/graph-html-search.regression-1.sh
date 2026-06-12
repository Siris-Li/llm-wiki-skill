#!/bin/bash
# Regression: offline graph should not ship the old search cockpit UI

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_omits_old_search_ui() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_not_contains "$html" 'class="search-box"'
    assert_file_not_contains "$html" 'id="search"'
    assert_file_not_contains "$html" "搜索节点、来源或主题"
    assert_file_not_contains "$html" 'id="no-results"'

    rm -rf "$tmp_dir"
}

test_graph_html_keeps_engine_search_helpers_for_model_queries() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "buildSearchIndex"
    assert_file_contains "$html" "applySearchToNodeIds"
    assert_file_contains "$html" "buildSearchHaystack"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_omits_old_search_ui
    test_graph_html_keeps_engine_search_helpers_for_model_queries
    echo "PASS: graph HTML search regression coverage"
}

main "$@"
