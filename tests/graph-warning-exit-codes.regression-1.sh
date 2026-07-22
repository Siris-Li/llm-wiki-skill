#!/bin/bash
# Regression: graph build/check commands expose stable 0/1/2 process contracts and stay read-only.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/scripts/wiki-link-cli.js"
BUILDER="$REPO_ROOT/scripts/build-graph-data.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

markdown_hashes() {
  local root="$1"
  find "$root" -type f -name '*.md' -exec shasum -a 256 {} \; | \
    sed "s#  $root/#  #" | LC_ALL=C sort
}

assert_read_only_status() {
  local expected="$1" root="$2"
  shift 2
  local before after status
  before="$(markdown_hashes "$root")"
  set +e
  "$@" > /dev/null 2>&1
  status=$?
  set -e
  after="$(markdown_hashes "$root")"
  [ "$status" -eq "$expected" ] || fail "expected exit $expected, got $status for: $*"
  [ "$before" = "$after" ] || fail "command changed Markdown: $*"
}

make_kb() {
  local root="$1"
  mkdir -p "$root/wiki/entities" "$root/wiki/sources" "$root/wiki/topics"
  printf '# Index\n' > "$root/index.md"
  printf '# Purpose\n' > "$root/purpose.md"
}

TMP_DIR="$(mktemp -d -t graph-warning-exits.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

BUILD_KB="$TMP_DIR/build-errors"
cp -R "$REPO_ROOT/tests/fixtures/graph-path-identity-wiki" "$BUILD_KB"
rm -f "$BUILD_KB/wiki/graph-data.json" "$BUILD_KB/wiki/graph-warnings.json" "$BUILD_KB/wiki/knowledge-graph.html"
rm -rf "$BUILD_KB/exports"
assert_read_only_status 0 "$BUILD_KB" env LLM_WIKI_TEST_MODE=1 bash "$BUILDER" "$BUILD_KB"
[ -f "$BUILD_KB/wiki/graph-data.json" ] || fail "successful degraded build did not create graph-data.json"
[ -f "$BUILD_KB/wiki/graph-warnings.json" ] || fail "successful degraded build did not create graph-warnings.json"

MISSING_ROOT="$TMP_DIR/does-not-exist"
set +e
LLM_WIKI_TEST_MODE=1 bash "$BUILDER" "$MISSING_ROOT" > /dev/null 2>&1
MISSING_STATUS=$?
set -e
[ "$MISSING_STATUS" -eq 1 ] || fail "missing knowledge base should exit 1, got $MISSING_STATUS"
[ ! -e "$MISSING_ROOT/wiki/graph-data.json" ] || fail "missing-root build created a graph artifact"

AMBIGUOUS_KB="$TMP_DIR/ambiguous"
make_kb "$AMBIGUOUS_KB"
printf '# Entity Foo\n' > "$AMBIGUOUS_KB/wiki/entities/foo.md"
printf '# Source Foo\n' > "$AMBIGUOUS_KB/wiki/sources/foo.md"
printf '# Link\n\n[[foo]]\n' > "$AMBIGUOUS_KB/wiki/topics/link.md"
assert_read_only_status 0 "$AMBIGUOUS_KB" node "$CLI" check "$AMBIGUOUS_KB"
assert_read_only_status 2 "$AMBIGUOUS_KB" node "$CLI" check "$AMBIGUOUS_KB" --strict

PENDING_KB="$TMP_DIR/pending"
make_kb "$PENDING_KB"
printf '# Pending\n\n[待创建: [[future]]]\n' > "$PENDING_KB/wiki/entities/pending.md"
assert_read_only_status 0 "$PENDING_KB" node "$CLI" check "$PENDING_KB" --strict

BROKEN_KB="$TMP_DIR/broken"
make_kb "$BROKEN_KB"
printf '# Broken\n\n[[missing]]\n' > "$BROKEN_KB/wiki/entities/broken.md"
assert_read_only_status 2 "$BROKEN_KB" node "$CLI" check "$BROKEN_KB" --strict

make_corrupt_runtime() {
  local root="$1" table="$2"
  mkdir -p "$root/scripts" "$root/deps"
  cp "$CLI" "$root/scripts/wiki-link-cli.js"
  cp -R "$REPO_ROOT/scripts/lib" "$root/scripts/lib"
  cp -R "$REPO_ROOT/deps/unicode" "$root/deps/unicode"
  printf '\n# deliberate test corruption\n' >> "$root/deps/unicode/$table"
}

UNICODE_KB="$TMP_DIR/unicode-kb"
make_kb "$UNICODE_KB"
printf '# Unicode\n' > "$UNICODE_KB/wiki/entities/unicode.md"

CASE_RUNTIME="$TMP_DIR/case-runtime"
make_corrupt_runtime "$CASE_RUNTIME" "CaseFolding-17.0.0.txt"
assert_read_only_status 1 "$UNICODE_KB" node "$CASE_RUNTIME/scripts/wiki-link-cli.js" check "$UNICODE_KB" --strict

NFC_RUNTIME="$TMP_DIR/nfc-runtime"
make_corrupt_runtime "$NFC_RUNTIME" "UnicodeData-17.0.0.txt"
assert_read_only_status 1 "$UNICODE_KB" node "$NFC_RUNTIME/scripts/wiki-link-cli.js" check "$UNICODE_KB" --strict

echo "PASS: graph warning exit-code regression coverage"
