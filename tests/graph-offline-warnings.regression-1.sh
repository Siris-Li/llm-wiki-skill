#!/bin/bash
# Regression: verified warning details render read-only in a real offline Chromium page.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

TMP_DIR="$(mktemp -d -t graph-offline-warnings.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
KB_ROOT="$TMP_DIR/kb"
LARGE_KB="$TMP_DIR/large-kb"
cp -R "$REPO_ROOT/tests/fixtures/graph-path-identity-wiki" "$KB_ROOT"
rm -f "$KB_ROOT/wiki/graph-data.json" "$KB_ROOT/wiki/graph-warnings.json" "$KB_ROOT/wiki/knowledge-graph.html"
rm -rf "$KB_ROOT/exports"

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
  || fail "graph-engine build should succeed before offline warning acceptance"
LLM_WIKI_TEST_MODE=1 bash "$REPO_ROOT/scripts/build-graph-data.sh" "$KB_ROOT" > /dev/null \
  || fail "path-identity graph fixture should build"
bash "$REPO_ROOT/scripts/build-graph-html.sh" "$KB_ROOT" > /dev/null \
  || fail "available warning HTML should build"

cp "$KB_ROOT/wiki/knowledge-graph.html" "$TMP_DIR/available.html"
cp "$KB_ROOT/wiki/graph-data.json" "$TMP_DIR/available-graph.json"
cp "$KB_ROOT/wiki/graph-warnings.json" "$TMP_DIR/available-warnings.json"

add_live_duplicate() {
  node - "$1" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const graph = JSON.parse(fs.readFileSync(file, "utf8"));
graph.nodes.push({ ...graph.nodes[0], label: "LIVE DUPLICATE MARKER" });
fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
NODE
}

add_live_duplicate "$KB_ROOT/wiki/graph-data.json"
node - "$KB_ROOT/wiki/graph-warnings.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const bundle = JSON.parse(fs.readFileSync(file, "utf8"));
bundle.build_id = "0".repeat(64);
fs.writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);
NODE
bash "$REPO_ROOT/scripts/build-graph-html.sh" "$KB_ROOT" > /dev/null \
  || fail "mismatched warning HTML should remain exportable"
cp "$KB_ROOT/wiki/knowledge-graph.html" "$TMP_DIR/mismatch.html"

cp "$TMP_DIR/available-graph.json" "$KB_ROOT/wiki/graph-data.json"
add_live_duplicate "$KB_ROOT/wiki/graph-data.json"
rm -f "$KB_ROOT/wiki/graph-warnings.json"
bash "$REPO_ROOT/scripts/build-graph-html.sh" "$KB_ROOT" > /dev/null \
  || fail "missing warning sidecar HTML should remain exportable"
cp "$KB_ROOT/wiki/knowledge-graph.html" "$TMP_DIR/missing.html"

cp "$TMP_DIR/available-graph.json" "$KB_ROOT/wiki/graph-data.json"
cp "$TMP_DIR/available-warnings.json" "$KB_ROOT/wiki/graph-warnings.json"
add_live_duplicate "$KB_ROOT/wiki/graph-data.json"
node - "$KB_ROOT/wiki/graph-data.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const graph = JSON.parse(fs.readFileSync(file, "utf8"));
delete graph.meta.warning_summary;
fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`);
NODE
bash "$REPO_ROOT/scripts/build-graph-html.sh" "$KB_ROOT" > /dev/null \
  || fail "legacy graph without warning summary should remain exportable"
cp "$KB_ROOT/wiki/knowledge-graph.html" "$TMP_DIR/legacy.html"

cp -R "$KB_ROOT" "$LARGE_KB"
cp "$TMP_DIR/available-graph.json" "$LARGE_KB/wiki/graph-data.json"
cp "$TMP_DIR/available-warnings.json" "$LARGE_KB/wiki/graph-warnings.json"
node - "$REPO_ROOT" "$LARGE_KB" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const [repoRoot, kbRoot] = process.argv.slice(2);
const { assembleGraphArtifactPair, commitGraphArtifactPair } = require(path.join(repoRoot, "scripts/lib/graph-warning-bundle"));
const graphData = JSON.parse(fs.readFileSync(path.join(kbRoot, "wiki/graph-data.json"), "utf8"));
delete graphData.meta.warning_summary;
const randomish = (seed, length) => {
  let value = "";
  for (let index = 0; value.length < length; index += 1) {
    value += crypto.createHash("sha256").update(`${seed}:${index}`).digest("hex");
  }
  return value.slice(0, length);
};
const candidateSets = Array.from({ length: 22 }, (_, setIndex) => ({
  candidate_set_id: `set-${String(setIndex).padStart(3, "0")}`,
  candidate_count: 30,
  candidates: Array.from({ length: 30 }, (_, candidateIndex) => `wiki/entities/${randomish(`candidate-${setIndex}-${candidateIndex}`, 200)}.md`).sort()
}));
const groups = Array.from({ length: 220 }, (_, groupIndex) => ({
  warning_id: `warning-${String(groupIndex).padStart(4, "0")}`,
  code: "ambiguous_wikilink",
  severity: "error",
  message: `Ambiguous ${randomish(`message-${groupIndex}`, 120)}`,
  target_key: `target-${groupIndex}`,
  candidate_set_id: candidateSets[groupIndex % candidateSets.length].candidate_set_id,
  occurrence_count: 30,
  occurrences: Array.from({ length: 30 }, (_, occurrenceIndex) => ({
    occurrence_id: `occ-${String(groupIndex).padStart(4, "0")}-${String(occurrenceIndex).padStart(2, "0")}`,
    source_path: "wiki/sources/links.md",
    line: occurrenceIndex + 1,
    column: 1,
    start_byte: occurrenceIndex * 801,
    end_byte: occurrenceIndex * 801 + 800,
    raw_link: `[[${randomish(`raw-${groupIndex}-${occurrenceIndex}`, 800)}]]`,
    file_sha256: randomish(`file-${groupIndex}`, 64),
    link_kind: "page_wikilink",
    read_only: false
  }))
}));
(async () => {
  const pair = assembleGraphArtifactPair({ graphData, groups, candidateSets });
  await commitGraphArtifactPair({
    kbRoot,
    graphPath: path.join(kbRoot, "wiki/graph-data.json"),
    warningPath: path.join(kbRoot, "wiki/graph-warnings.json"),
    pair
  });
})().catch((error) => { console.error(error); process.exit(1); });
NODE
bash "$REPO_ROOT/scripts/build-graph-html.sh" "$LARGE_KB" > /dev/null \
  || fail "large warning HTML should build"
cp "$LARGE_KB/wiki/knowledge-graph.html" "$TMP_DIR/large.html"

chrome_executable="$(graph_browser_chrome_executable "${GRAPH_OFFLINE_WARNING_CHROME_EXECUTABLE:-}")"
playwright_node_path="$(graph_browser_playwright_node_path)"

cd "$REPO_ROOT"
GRAPH_WARNING_AVAILABLE_HTML="$TMP_DIR/available.html" \
GRAPH_WARNING_AVAILABLE_GRAPH="$TMP_DIR/available-graph.json" \
GRAPH_WARNING_AVAILABLE_SIDECAR="$TMP_DIR/available-warnings.json" \
GRAPH_WARNING_MISMATCH_HTML="$TMP_DIR/mismatch.html" \
GRAPH_WARNING_MISSING_HTML="$TMP_DIR/missing.html" \
GRAPH_WARNING_LEGACY_HTML="$TMP_DIR/legacy.html" \
GRAPH_WARNING_LARGE_HTML="$TMP_DIR/large.html" \
GRAPH_WARNING_TEMP_KB="$TMP_DIR" \
GRAPH_OFFLINE_WARNING_CHROME_EXECUTABLE="$chrome_executable" \
NODE_PATH="$playwright_node_path" \
node tests/browser/graph-offline-warnings.mjs

echo "PASS: offline graph warning browser regression coverage"
