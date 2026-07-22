#!/bin/bash
# Regression: production graph builds use path identity, pair warnings, and never rewrite Markdown.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$REPO_ROOT/tests/fixtures/graph-path-identity-wiki"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

markdown_hashes() {
  local root="$1"
  find "$root" -type f -name '*.md' -exec shasum -a 256 {} \; | \
    sed "s#  $root/#  #" | LC_ALL=C sort
}

TMP_DIR="$(mktemp -d -t graph-path-build.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
KB_ROOT="$TMP_DIR/kb"
cp -R "$FIXTURE" "$KB_ROOT"
rm -f "$KB_ROOT/wiki/graph-data.json" "$KB_ROOT/wiki/graph-warnings.json" "$KB_ROOT/wiki/knowledge-graph.html"
rm -rf "$KB_ROOT/exports"

BEFORE_HASH="$TMP_DIR/markdown.before"
AFTER_HASH="$TMP_DIR/markdown.after"
markdown_hashes "$KB_ROOT" > "$BEFORE_HASH"

set +e
LLM_WIKI_TEST_MODE=1 bash "$REPO_ROOT/scripts/build-graph-data.sh" "$KB_ROOT" > "$TMP_DIR/build.out" 2>&1
BUILD_STATUS=$?
set -e
[ "$BUILD_STATUS" -eq 0 ] || {
  cat "$TMP_DIR/build.out" >&2
  fail "graph build with intentional data warnings should exit 0, got $BUILD_STATUS"
}

GRAPH="$KB_ROOT/wiki/graph-data.json"
WARNINGS="$KB_ROOT/wiki/graph-warnings.json"
[ -f "$GRAPH" ] || fail "graph-data.json was not created"
[ -f "$WARNINGS" ] || fail "paired graph-warnings.json was not created"

jq -e --slurpfile expected "$KB_ROOT/expected.json" '
  ($expected[0].graphSources | sort) as $expected_nodes
  | (.nodes | map(.id) | sort) == $expected_nodes
  and (.nodes | length == 8)
  and (all(.nodes[]; .id == .source_path))
  and ([.nodes[] | select(.id | endswith("/foo.md"))] | length == 3)
  and (all(.nodes[]; (.id | startswith("wiki/entities/") or startswith("wiki/topics/") or startswith("wiki/sources/") or startswith("wiki/comparisons/") or startswith("wiki/synthesis/") or startswith("wiki/queries/"))))
  and ((.edges | map({from, to, confidence, relation_type}) | sort_by(.from, .to)) == ([
    {from:"wiki/sources/links.md",to:"wiki/comparisons/unique.md",confidence:"EXTRACTED",relation_type:"依赖"},
    {from:"wiki/sources/links.md",to:"wiki/entities/foo.md",confidence:"EXTRACTED",relation_type:"依赖"},
    {from:"wiki/sources/links.md",to:"wiki/synthesis/future.md",confidence:"EXTRACTED",relation_type:"依赖"},
    {from:"wiki/sources/links.md",to:"wiki/topics/foo.md",confidence:"EXTRACTED",relation_type:"依赖"}
  ] | sort_by(.from, .to)))
  and ((.meta.warning_summary.by_code // {}) == {
    ambiguous_wikilink:1,
    broken_wikilink:2,
    pending_wikilink:2
  })
  and (.meta.warning_summary.total_groups == 5)
  and (.meta.warning_summary.total_occurrences == 5)
  and (.meta.warning_summary.error_occurrences == 3)
  and (.meta.warning_summary.warning_occurrences == 2)
  and (.meta.warning_summary.details_ref == "wiki/graph-warnings.json")
  and (. as $graph | ($graph.nodes | map(.id)) as $ids | all($graph.edges[]; . as $edge | ($ids | index($edge.from)) != null and ($ids | index($edge.to)) != null))
  and (. as $graph | ($graph.nodes | map(.id)) as $ids | all($graph.meta.initial_view[]; . as $id | ($ids | index($id)) != null))
  and (. as $graph | ($graph.nodes | map(.id)) as $ids | all($graph.learning.views.path.node_ids[]; . as $id | ($ids | index($id)) != null))
  and (. as $graph | ($graph.nodes | map(.id)) as $ids | all($graph.learning.views.community.node_ids[]; . as $id | ($ids | index($id)) != null))
  and (. as $graph | ($graph.nodes | map(.id)) as $ids | all($graph.learning.views.global.node_ids[]; . as $id | ($ids | index($id)) != null))
  and (. as $graph | ($graph.nodes | map(.id)) as $ids | all($graph.learning.communities[]; .recommended_start_node_id as $id | ($ids | index($id)) != null))
  and (. as $graph | ($graph.nodes | map(.id)) as $ids | all($graph.insights.isolated_nodes[]; .id as $id | ($ids | index($id)) != null))
  and (. as $graph | ($graph.nodes | map(.id)) as $ids | all($graph.insights.bridge_nodes[]; .id as $id | ($ids | index($id)) != null))
' "$GRAPH" > /dev/null || fail "graph path identity or reference contract did not match the checked fixture"

jq -e '
  .version == 1
  and (.candidate_sets | length == 1)
  and (.candidate_sets[0].candidate_count == 4)
  and (.candidate_sets[0].candidates == [
    "raw/notes/foo.md",
    "wiki/entities/foo.md",
    "wiki/sources/foo.md",
    "wiki/topics/foo.md"
  ])
  and ([.groups[].code] | sort == ["ambiguous_wikilink","broken_wikilink","broken_wikilink","pending_wikilink","pending_wikilink"])
  and (all(.groups[].occurrences[]; (.source_path | startswith("/")) | not))
' "$WARNINGS" > /dev/null || fail "warning sidecar contract did not match the checked fixture"

node - "$REPO_ROOT" "$KB_ROOT" <<'NODE'
const path = require("node:path");
const [repoRoot, kbRoot] = process.argv.slice(2);
const { verifyGraphArtifactPair } = require(path.join(repoRoot, "scripts/lib/graph-warning-bundle"));
(async () => {
  const verified = await verifyGraphArtifactPair({
    kbRoot,
    graphPath: path.join(kbRoot, "wiki/graph-data.json"),
    warningPath: path.join(kbRoot, "wiki/graph-warnings.json")
  });
  if (verified.status !== "available") throw new Error(`pair verification failed: ${verified.reason}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE

markdown_hashes "$KB_ROOT" > "$AFTER_HASH"
cmp -s "$BEFORE_HASH" "$AFTER_HASH" || fail "graph build changed Markdown content"

echo "PASS: graph path identity build regression coverage"
