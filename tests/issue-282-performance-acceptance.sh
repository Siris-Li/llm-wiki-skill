#!/bin/bash
# Issue #282: 迁移后性能与 ESM/IIFE 双产物验收
#
# 端到端真机验收(手动跑,不进 CI):
#   1. 构建图谱引擎双产物(ESM + IIFE)
#   2. 候选 hover 捕获:生产 nodes-1000-sparse + 隔离 1k/5k/10k,各连续 3 次
#   3. 自动比较器 vs #272 不可变基线(afterMedian <= beforeMedian + max(before*0.20, 50ms))
#      —— 比较器内强制 formula/构建方式/浏览器版本/运行次数一致,候选超标则以非零码退出
#   4. 生产 1k 全动作硬门禁(13 动作:初次显示/搜索/进入社区/返回全局/内存/hover…)= ESM 浏览器加载证明
#   5. 离线宿主构建消费 IIFE(build-graph-html.sh 冒烟,无浏览器)
#
# 约束:不删动作、不重写基线、不扩容差、不换更轻数据、不加长期缓存。
# 浏览器用打包版 Playwright Chromium(149.0.7827.55,与 #272 基线一致),故不覆盖 chrome 可执行路径。
#
# 用法:bash tests/issue-282-performance-acceptance.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/issue-282-acceptance.XXXXXX")"
fixture_tmp=""
trap 'rm -rf "$tmp_dir" "$fixture_tmp"' EXIT

echo "== [0/5] 构建图谱引擎双产物 =="
npm run build -w @llm-wiki/graph-engine > /dev/null
esm_size=$(wc -c < packages/graph-engine/dist/engine.esm.js | tr -d ' ')
iife_size=$(wc -c < packages/graph-engine/dist/engine.iife.js | tr -d ' ')
echo "   ESM=${esm_size} bytes  IIFE=${iife_size} bytes"

echo "== [1/5] 候选 hover 捕获(生产 1k + 隔离 1k/5k/10k,各 3 次) =="
# 捕获器内部:自建引擎、循环 3 次、产出 hover-medians.json + run 文件;--output 目录不得已存在。
node tests/browser/capture-issue-159-hover-baseline.mjs \
  --mode candidate \
  --output "$tmp_dir/candidate"
echo "   候选结果:$tmp_dir/candidate"

echo "== [2/5] 自动比较器 vs #272 不可变基线 =="
# 比较器:任一 entry 超标则退出码 1(真实性能回归)。tee 保留判定明细供结论文档誊写。
node tests/browser/compare-issue-159-hover-baseline.mjs \
  docs/graph/performance/artifacts/issue-159/baseline/hover-medians.json \
  "$tmp_dir/candidate/hover-medians.json" | tee "$tmp_dir/comparison.json"
echo "   比较明细:$tmp_dir/comparison.json"

echo "== [3/5] 生产 1k 全动作硬门禁(ESM 浏览器加载 + 13 动作门禁) =="
# 复用既有回归脚本(自带构建、playwright 解析、validateTrialResults 硬门禁与产物校验)。
# GRAPH_SIGMA_PRODUCTION_SHAPES 聚焦到 nodes-1000-sparse;不设 ACTIONS → 跑全 13 动作。
GRAPH_SIGMA_PRODUCTION_SHAPES=nodes-1000-sparse \
  bash tests/graph-sigma-global-production.regression-1.sh

echo "== [4/5] 离线宿主构建消费 IIFE(build-graph-html.sh 冒烟) =="
fixture_tmp="$(mktemp -d "${TMPDIR:-/tmp}/issue-282-offline.XXXXXX")"
cp -R tests/fixtures/graph-interactive-basic "$fixture_tmp/graph-interactive-basic"
bash scripts/build-graph-html.sh "$fixture_tmp/graph-interactive-basic" > /dev/null
offline_html="$fixture_tmp/graph-interactive-basic/wiki/knowledge-graph.html"
[ -s "$offline_html" ] || { echo "   FAIL: 离线 HTML 为空"; exit 1; }
grep -q "LlmWikiGraphEngine" "$offline_html" || { echo "   FAIL: 离线 HTML 未内联 IIFE 引擎"; exit 1; }
echo "   离线 HTML 已内联 IIFE 引擎($(wc -c < "$offline_html" | tr -d ' ') bytes)"

echo "== [5/5] 完成 =="
echo "PASS: issue-282 性能与双产物验收"
echo "候选 hover 中位数:    $tmp_dir/candidate/hover-medians.json"
echo "比较明细:              $tmp_dir/comparison.json"
echo "退休前 ESM/IIFE 大小:  esm=${esm_size} iife=${iife_size}"
