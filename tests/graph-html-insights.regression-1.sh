#!/bin/bash
# Regression: engine atlas should keep weighted relationship cues

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_weighted_edge_hooks() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "edgeStrokeWidth"
    assert_file_contains "$html" "edgeOpacity"
    assert_file_contains "$html" "strokeWidth"
    assert_file_contains "$html" "opacity"
    assert_file_contains "$html" "atlasConfidenceLabel"

    rm -rf "$tmp_dir"
}

test_graph_html_has_structural_selection_actions_without_offline_ask_ui() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "why_no_connection"
    assert_file_contains "$html" "find_potential_bridges"
    assert_file_contains "$html" "resolveSelectionForCapabilities"
    assert_file_not_contains "$html" "提问选区"
    assert_file_not_contains "$html" "onAsk:"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_has_weighted_edge_hooks
    test_graph_html_has_structural_selection_actions_without_offline_ask_ui
    echo "PASS: graph HTML insights regression coverage"
}

main "$@"
