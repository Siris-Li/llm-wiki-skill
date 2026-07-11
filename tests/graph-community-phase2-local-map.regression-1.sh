#!/bin/bash
# Regression: community reading stays on the Sigma primary route and preserves source community context on return.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

tmp_dir="$(mktemp -d)"
server_pid=""
web_pid=""
server_port="${GRAPH_COMMUNITY_PHASE2_SERVER_PORT:-18789}"
web_port="${GRAPH_COMMUNITY_PHASE2_WEB_PORT:-15182}"

cleanup() {
    if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
    if [ -n "$web_pid" ]; then kill "$web_pid" 2>/dev/null || true; fi
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

if lsof -i TCP:"$server_port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $server_port is already in use"
fi
if lsof -i TCP:"$web_port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $web_port is already in use"
fi

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
    || fail "graph-engine build should succeed before Phase 2 browser regression"

workbench_kb="$tmp_dir/home/llm-wiki/phase-2-local-map"
mkdir -p "$workbench_kb/wiki/entities" "$tmp_dir/home/.llm-wiki-agent"

cat > "$workbench_kb/.wiki-schema.md" <<'EOF'
# Test schema
EOF

cat > "$workbench_kb/purpose.md" <<'EOF'
# Phase 2 Local Map Test
EOF

node - "$workbench_kb/wiki/graph-data.json" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const nodes = [
  { id: "A", label: "核心节点A", type: "topic", community: "t1", source_path: "wiki/entities/A.md", x: 24, y: 42, weight: 95 },
  { id: "B", label: "关键节点B", type: "entity", community: "t1", source_path: "wiki/entities/B.md", x: 36, y: 32, weight: 72 },
  { id: "C", label: "来源节点C", type: "source", community: "t1", source_path: "wiki/entities/C.md", x: 38, y: 56, weight: 64 },
  { id: "D", label: "普通节点D", type: "entity", community: "t1", source_path: "wiki/entities/D.md", x: 55, y: 34, weight: 50 },
  { id: "E", label: "普通节点E", type: "entity", community: "t1", source_path: "wiki/entities/E.md", x: 68, y: 38, weight: 42 },
  { id: "F", label: "对比节点F", type: "comparison", community: "t1", source_path: "wiki/entities/F.md", x: 80, y: 46, weight: 35 },
  { id: "G", label: "外部节点G", type: "entity", community: "t2", source_path: "wiki/entities/G.md", x: 72, y: 78, weight: 25 },
  { id: "H", label: "外部节点H", type: "topic", community: "t2", source_path: "wiki/entities/H.md", x: 84, y: 74, weight: 22 }
];
// Extra low-weight t1 members push the community past the core/label budget so
// the local map exercises real core/related/peripheral tiering.
const t1Filler = Array.from({ length: 10 }, (_, index) => ({
  id: `T${index}`,
  label: `外围节点T${index}`,
  type: "entity",
  community: "t1",
  source_path: `wiki/entities/T${index}.md`,
  x: 20 + (index * 6) % 60,
  y: 20 + (index * 9) % 55,
  weight: 12 - index
}));
nodes.push(...t1Filler);
const edges = [
  { id: "eAB", from: "A", to: "B", type: "EXTRACTED", confidence: "EXTRACTED", relation_type: "实现", weight: 1 },
  { id: "eAC", from: "A", to: "C", type: "INFERRED", confidence: "INFERRED", relation_type: "对比", weight: 0.8 },
  { id: "eBD", from: "B", to: "D", type: "EXTRACTED", confidence: "EXTRACTED", relation_type: "依赖", weight: 0.7 },
  { id: "eDE", from: "D", to: "E", type: "EXTRACTED", confidence: "EXTRACTED", relation_type: "衍生", weight: 0.5 },
  { id: "eEF", from: "E", to: "F", type: "AMBIGUOUS", confidence: "AMBIGUOUS", relation_type: "矛盾", weight: 0.4 },
  { id: "eFG", from: "F", to: "G", type: "INFERRED", confidence: "INFERRED", relation_type: "跨社区", weight: 0.2 },
  { id: "eGH", from: "G", to: "H", type: "EXTRACTED", confidence: "EXTRACTED", relation_type: "补充", weight: 0.7 }
];
// A single spine edge each so filler nodes stay attached but low-priority.
for (let index = 0; index < t1Filler.length; index += 1) {
  edges.push({ id: `eT${index}`, from: index === 0 ? "E" : `T${index - 1}`, to: `T${index}`, type: "EXTRACTED", confidence: "EXTRACTED", relation_type: "衍生", weight: 0.1 });
}
for (const node of nodes) {
  node.content = `# ${node.label}\n\n这是${node.label}的内容。\n`;
}
const t1Members = nodes.filter((node) => node.community === "t1").map((node) => node.id);
const t2Members = nodes.filter((node) => node.community === "t2").map((node) => node.id);
const graph = {
  meta: {
    build_date: "2026-07-03T00:00:00.000Z",
    wiki_title: "Phase 2 Local Map Test",
    total_nodes: nodes.length,
    total_edges: edges.length
  },
  nodes,
  edges,
  learning: {
    version: 1,
    entry: { recommended_start_node_id: "A", recommended_start_reason: "测试入口", default_mode: "global" },
    views: {
      path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
      community: { enabled: true, community_id: "t1", label: "测试社区", node_ids: t1Members, is_weak: false, degraded: false },
      global: { enabled: true, node_ids: nodes.map((node) => node.id), degraded: false }
    },
    communities: [
      { id: "t1", label: "测试社区", node_count: t1Members.length, color_index: 0, recommended_start_node_id: "A", members: t1Members, is_primary: true },
      { id: "t2", label: "外部社区", node_count: t2Members.length, color_index: 1, members: t2Members }
    ]
  }
};
fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
NODE

for id in A B C D E F G H; do
    cat > "$workbench_kb/wiki/entities/$id.md" <<EOF
# 节点$id

这是节点$id 的内容。
EOF
done

cat > "$tmp_dir/home/.llm-wiki-agent/config.json" <<JSON
{
  "version": 1,
  "externalKnowledgeBases": [],
  "lastUsedKbPath": "$workbench_kb"
}
JSON

HOME="$tmp_dir/home" HOST=127.0.0.1 PORT="$server_port" npm run dev -w @llm-wiki-agent/server > "$tmp_dir/server.log" 2>&1 &
server_pid="$!"
HOME="$tmp_dir/home" LLM_WIKI_AGENT_API_ORIGIN="http://127.0.0.1:$server_port" npm run dev -w @llm-wiki-agent/web -- --host 127.0.0.1 --port "$web_port" --force > "$tmp_dir/web.log" 2>&1 &
web_pid="$!"

for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$server_port/api/knowledge-bases" >/dev/null 2>&1 \
        && curl -fsS "http://127.0.0.1:$web_port" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done

curl -fsS "http://127.0.0.1:$server_port/api/knowledge-bases" >/dev/null 2>&1 \
    || fail "workbench server did not start; see $tmp_dir/server.log"
curl -fsS "http://127.0.0.1:$web_port" >/dev/null 2>&1 \
    || fail "workbench web did not start; see $tmp_dir/web.log"

playwright_node_path="$(
    npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"

chrome_executable="${GRAPH_COMMUNITY_PHASE2_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

artifact_dir="${GRAPH_COMMUNITY_PHASE2_ARTIFACT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/llm-wiki-community-phase2.XXXXXX")}"

GRAPH_COMMUNITY_PHASE2_URL="http://127.0.0.1:$web_port" \
GRAPH_COMMUNITY_PHASE2_CHROME_EXECUTABLE="$chrome_executable" \
GRAPH_COMMUNITY_PHASE2_ARTIFACT_DIR="$artifact_dir" \
NODE_PATH="$playwright_node_path" \
node "$REPO_ROOT/tests/browser/graph-community-phase2-local-map.mjs" \
    || fail "Phase 2 community local map browser regression should pass"

echo "PASS: graph community Phase 2 local map regression"
echo "ARTIFACTS: $artifact_dir"
