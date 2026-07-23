#!/bin/bash
# lint-output.regression-1.sh — 验证 lint 输出结构（排除时间和路径）
set -eu

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$SKILL_DIR/tests/fixtures/lint-sample-wiki"
EXPECTED="$SKILL_DIR/tests/expected/lint-output.txt"

if [ ! -f "$EXPECTED" ]; then
  echo "FAIL: expected output not found: $EXPECTED"
  exit 1
fi

# 运行 lint，捕获输出
ACTUAL=$(bash "$SKILL_DIR/scripts/lint-runner.sh" "$FIXTURE" 2>/dev/null)

# 稳定化：替换时间为占位符，替换绝对路径为相对路径
ACTUAL_STABLE=$(echo "$ACTUAL" | \
  sed -E 's/时间：[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}/时间：YYYY-MM-DD HH:MM/' | \
  sed "s|$FIXTURE|tests/fixtures/lint-sample-wiki|g")

EXPECTED_STABLE=$(cat "$EXPECTED")

if [ "$ACTUAL_STABLE" = "$EXPECTED_STABLE" ]; then
  :
else
  echo "FAIL: lint output does not match expected"
  echo "--- diff (actual vs expected) ---"
  diff <(echo "$ACTUAL_STABLE") <(echo "$EXPECTED_STABLE") || true
  exit 1
fi

TMP_DIR="$(mktemp -d -t lint-shared-report.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
KB_ROOT="$TMP_DIR/kb"
cp -R "$FIXTURE" "$KB_ROOT"
mkdir -p "$KB_ROOT/wiki/entities/nested" "$KB_ROOT/wiki/topics/nested"
cat > "$KB_ROOT/wiki/entities/nested/Dupe.md" <<'EOF'
# Entity Dupe
EOF
cat > "$KB_ROOT/wiki/topics/nested/Dupe.md" <<'EOF'
# Topic Dupe
EOF
cat >> "$KB_ROOT/index.md" <<'EOF'

- [[wiki/entities/nested/Dupe|Entity alias]]
- [[wiki/topics/nested/Dupe#Heading|Topic heading]]
- [[Dupe]]
- `[[Lonely]]`
EOF

JSON_OUT="$TMP_DIR/lint.json"
set +e
bash "$SKILL_DIR/scripts/lint-runner.sh" "$KB_ROOT" --json > "$JSON_OUT"
JSON_STATUS=$?
bash "$SKILL_DIR/scripts/lint-runner.sh" "$KB_ROOT" --strict --json > "$TMP_DIR/lint-strict.json"
STRICT_JSON_STATUS=$?
bash "$SKILL_DIR/scripts/lint-runner.sh" "$KB_ROOT" --strict > "$TMP_DIR/lint-strict.txt"
STRICT_TEXT_STATUS=$?
set -e

[ "$JSON_STATUS" -eq 0 ] || {
  echo "FAIL: default JSON lint should exit 0, got $JSON_STATUS"
  exit 1
}
[ "$STRICT_JSON_STATUS" -eq 2 ] || {
  echo "FAIL: strict JSON lint should exit 2 for ambiguity, got $STRICT_JSON_STATUS"
  exit 1
}
[ "$STRICT_TEXT_STATUS" -eq 2 ] || {
  echo "FAIL: strict text lint should exit 2 for ambiguity, got $STRICT_TEXT_STATUS"
  exit 1
}

jq -e '
  (.warning_report.groups | map(select(.code == "ambiguous_wikilink" and .target_key == "Dupe")) | length) == 1
  and (.warning_report.candidate_sets | map(select(.candidates == ["wiki/entities/nested/Dupe.md", "wiki/topics/nested/Dupe.md"])) | length) == 1
  and (.derived.index_resolved_target_paths | index("wiki/entities/nested/Dupe.md")) != null
  and (.derived.index_resolved_target_paths | index("wiki/topics/nested/Dupe.md")) != null
  and (.derived.index_unlisted_paths | index("wiki/entities/nested/Dupe.md")) == null
  and (.derived.index_unlisted_paths | index("wiki/topics/nested/Dupe.md")) == null
  and (.derived.orphan_paths | index("wiki/entities/nested/Dupe.md")) == null
  and (.derived.orphan_paths | index("wiki/topics/nested/Dupe.md")) == null
  and (.derived.orphan_paths | index("wiki/entities/Lonely.md")) != null
  and (.warning_report.metrics.inventory_walks == 1)
  and (.warning_report.metrics.target_index_builds == 1)
  and (.warning_report.metrics.source_files_parsed == (.warning_report.inventory.lintSources | length))
' "$JSON_OUT" > /dev/null || {
  echo "FAIL: lint JSON did not use the shared path-aware report"
  exit 1
}

grep -F -- "--- 歧义链接" "$TMP_DIR/lint-strict.txt" > /dev/null || {
  echo "FAIL: lint text did not render the ambiguity section"
  exit 1
}
grep -F -- "--- 待创建链接" "$TMP_DIR/lint-strict.txt" > /dev/null || {
  echo "FAIL: lint text did not render the pending section"
  exit 1
}

echo "PASS: lint output regression"
