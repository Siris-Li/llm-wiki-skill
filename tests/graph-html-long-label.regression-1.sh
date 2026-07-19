#!/bin/bash
# Regression: long card labels should truncate safely and expose full title text

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

LONG_LABEL="这是一个非常长的中文 Alpha 👩‍💻 图谱节点标题，用来验证用户看到的省略结果和完整标题"

test_default_nodes_hide_details_until_hover_or_selection() {
    local tmp_dir html playwright_node_path
    tmp_dir="$(mktemp -d)"

    npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
        || fail "graph-engine build should succeed before node slim browser regression"
    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"
    node - "$tmp_dir/wiki/graph-data.json" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const graph = JSON.parse(fs.readFileSync(file, "utf8"));
graph.nodes.push({
  id: "empty-preview",
  label: "空内容节点",
  type: "topic",
  community: "t1",
  content: "",
  source_path: "/fake/wiki/topics/empty-preview.md"
});
graph.meta.total_nodes = graph.nodes.length;
fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
NODE
    bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on node preview fixture"
    playwright_node_path="$(
        npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
    )"

    GRAPH_NODE_SLIM_HTML="$html" NODE_PATH="$playwright_node_path" node "$REPO_ROOT/tests/browser/graph-node-slim.mjs" \
        || fail "default node slim browser regression should pass"

    rm -rf "$tmp_dir"
}

test_long_label_is_visibly_truncated_and_fully_readable() {
    local tmp_dir html playwright_node_path
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"
    LONG_LABEL="$LONG_LABEL" node - "$tmp_dir/wiki/graph-data.json" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const graph = JSON.parse(fs.readFileSync(file, "utf8"));
graph.nodes.push({
  id: "long-label",
  label: process.env.LONG_LABEL,
  type: "topic",
  community: "t1",
  content: "# 长标题节点\n\n正文用于长标题可见结果验证。",
  source_path: "/fake/wiki/topics/long-label.md"
});
graph.meta.total_nodes = graph.nodes.length;
fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
NODE
    bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on long-label fixture"
    playwright_node_path="$(
        npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
    )"
    GRAPH_HTML_LONG_LABEL_HTML="$html" GRAPH_HTML_LONG_LABEL_TEXT="$LONG_LABEL" NODE_PATH="$playwright_node_path" \
        node "$REPO_ROOT/tests/browser/graph-html-long-label.mjs" \
        || fail "offline graph should visibly truncate the long label while keeping the full title readable"

    rm -rf "$tmp_dir"
}

main() {
    npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
        || fail "graph-engine build should succeed before long-label regression"
    test_long_label_is_visibly_truncated_and_fully_readable
    test_default_nodes_hide_details_until_hover_or_selection
    echo "PASS: graph HTML long-label regression coverage"
}

main "$@"
