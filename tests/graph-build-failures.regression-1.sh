#!/bin/bash
# Regression: graph build should fail clearly when node/engine path is broken

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRAPH_DATA_SAMPLE="$REPO_ROOT/tests/fixtures/graph-data-sample-wiki"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_text_contains() {
    local text="$1"
    local expected="$2"

    if ! printf '%s' "$text" | grep -F -- "$expected" > /dev/null; then
        fail "Expected output to contain: $expected"
    fi
}

copy_graph_runtime() {
    local destination="$1"
    mkdir -p "$destination/scripts" "$destination/deps" "$destination/tests/fixtures"
    cp "$REPO_ROOT/scripts/build-graph-data.sh" "$destination/scripts/"
    cp "$REPO_ROOT/scripts/build-graph-html.sh" "$destination/scripts/"
    cp "$REPO_ROOT/scripts/graph-analysis.js" "$destination/scripts/"
    cp "$REPO_ROOT/scripts/wiki-link-cli.js" "$destination/scripts/"
    cp "$REPO_ROOT/scripts/shared-config.sh" "$destination/scripts/"
    cp -R "$REPO_ROOT/scripts/lib" "$destination/scripts/lib"
    cp -R "$REPO_ROOT/deps/unicode" "$destination/deps/unicode"
    cp "$REPO_ROOT/deps/marked.min.js" "$destination/deps/marked.min.js"
    cp "$REPO_ROOT/deps/purify.min.js" "$destination/deps/purify.min.js"
    mkdir -p "$destination/packages/graph-engine/dist"
    cp "$REPO_ROOT/packages/graph-engine/dist/engine.iife.js" "$destination/packages/graph-engine/dist/engine.iife.js"
}

test_graph_data_exits_without_node() {
    local tmp_dir fake_bin output
    tmp_dir="$(mktemp -d)"
    fake_bin="$tmp_dir/bin"
    mkdir -p "$fake_bin"

    ln -s /bin/bash "$fake_bin/bash"
    ln -s "$(command -v jq)" "$fake_bin/jq"

    if output="$(PATH="$fake_bin" bash "$REPO_ROOT/scripts/build-graph-data.sh" "$GRAPH_DATA_SAMPLE" 2>&1)"; then
        fail "build-graph-data.sh should fail when node is unavailable"
    fi

    assert_text_contains "$output" "node"
    assert_text_contains "$output" "Install it via"

    rm -rf "$tmp_dir"
}

test_graph_data_exits_when_helper_missing() {
    local tmp_dir repo_copy output
    tmp_dir="$(mktemp -d)"
    repo_copy="$tmp_dir/repo"

    copy_graph_runtime "$repo_copy"
    cp -R "$GRAPH_DATA_SAMPLE" "$repo_copy/tests/fixtures/graph-data-sample-wiki"
    rm "$repo_copy/scripts/graph-analysis.js"

    if output="$(LLM_WIKI_TEST_MODE=1 bash "$repo_copy/scripts/build-graph-data.sh" "$repo_copy/tests/fixtures/graph-data-sample-wiki" 2>&1)"; then
        fail "build-graph-data.sh should fail when helper is missing"
    fi

    assert_text_contains "$output" "graph-analysis.js"
    assert_text_contains "$output" "图谱分析 helper"

    rm -rf "$tmp_dir"
}

test_graph_data_exits_when_resolver_or_bundle_missing_without_replacing_graph() {
    local tmp_dir repo_copy kb output helper
    for helper in wiki-link-cli.js lib/graph-warning-bundle.js; do
        tmp_dir="$(mktemp -d)"
        repo_copy="$tmp_dir/repo"
        kb="$tmp_dir/kb"
        copy_graph_runtime "$repo_copy"
        cp -R "$GRAPH_DATA_SAMPLE" "$kb"
        printf 'stable old graph\n' > "$kb/wiki/graph-data.json"
        rm "$repo_copy/scripts/$helper"

        if output="$(LLM_WIKI_TEST_MODE=1 bash "$repo_copy/scripts/build-graph-data.sh" "$kb" 2>&1)"; then
            fail "build-graph-data.sh should fail when $helper is missing"
        fi
        assert_text_contains "$output" "missing"
        assert_text_contains "$(cat "$kb/wiki/graph-data.json")" "stable old graph"
        rm -rf "$tmp_dir"
    done
}

test_graph_html_keeps_existing_html_when_engine_asset_missing() {
    local tmp_dir repo_copy output html_path
    tmp_dir="$(mktemp -d)"
    repo_copy="$tmp_dir/repo"

    copy_graph_runtime "$repo_copy"
    cp -R "$REPO_ROOT/tests/fixtures/graph-interactive-basic" "$repo_copy/tests/fixtures/graph-interactive-basic"
    rm "$repo_copy/packages/graph-engine/dist/engine.iife.js"

    html_path="$repo_copy/tests/fixtures/graph-interactive-basic/wiki/knowledge-graph.html"
    printf 'stable old html\n' > "$html_path"

    if output="$(bash "$repo_copy/scripts/build-graph-html.sh" "$repo_copy/tests/fixtures/graph-interactive-basic" 2>&1)"; then
        fail "build-graph-html.sh should fail when engine asset is missing"
    fi

    assert_text_contains "$output" "engine.iife.js"
    assert_text_contains "$output" "graph-engine IIFE 产物"
    assert_text_contains "$(cat "$html_path")" "stable old html"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_data_exits_without_node
    test_graph_data_exits_when_helper_missing
    test_graph_data_exits_when_resolver_or_bundle_missing_without_replacing_graph
    test_graph_html_keeps_existing_html_when_engine_asset_missing
    echo "PASS: graph build failure regression coverage"
}

main "$@"
