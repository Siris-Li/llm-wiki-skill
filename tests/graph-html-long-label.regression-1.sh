#!/bin/bash
# Regression: long card labels should truncate safely and expose full title text

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_truncate_label_markup_hooks() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" ".node-name"
    assert_file_contains "$html" "text-overflow: ellipsis;"
    assert_file_contains "$html" "white-space: nowrap;"
    assert_file_contains "$html" "r.title=e.label"
    assert_file_contains "$html" "node-kind"
    assert_file_contains "$html" "node-meta"
    assert_file_contains "$html" "graph-reader-body pre"
    assert_file_contains "$html" "overflow-wrap: anywhere;"

    rm -rf "$tmp_dir"
}

test_label_truncation_helpers_are_carried_by_engine_bundle() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "truncateLabel"
    assert_file_contains "$html" "splitLabelGraphemes"
    assert_file_contains "$html" "cardDims"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_has_truncate_label_markup_hooks
    test_label_truncation_helpers_are_carried_by_engine_bundle
    echo "PASS: graph HTML long-label regression coverage"
}

main "$@"
