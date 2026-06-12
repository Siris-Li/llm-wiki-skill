#!/bin/bash
# Regression: engine graph HTML should keep minimap landmarks

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_minimap_markup() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" ".mini-map"
    assert_file_contains "$html" ".mini-map svg"
    assert_file_contains "$html" ".mini-map .is-selected"
    assert_file_contains "$html" 'viewBox`,`0 0 160 54`'

    rm -rf "$tmp_dir"
}

test_graph_html_minimap_runtime_renders_nodes() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "t.minimap.nodes"
    assert_file_contains "$html" 'createElementNS(X,`circle`)'
    assert_file_contains "$html" 'e.selected&&t.classList.add(`is-selected`)'
    assert_file_contains "$html" "miniNodeElements"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_has_minimap_markup
    test_graph_html_minimap_runtime_renders_nodes
    echo "PASS: graph HTML minimap regression coverage"
}

main "$@"
