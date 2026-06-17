# Graph Renderer 协调逻辑拆分执行计划

日期：2026-06-17

## 目标

落实 `docs/spark/2026-06-17-static-renderer-coordination-split-design.md`（B 路线）：把 `packages/graph-engine/src/render/static-renderer.ts`（2481 行、四职责混合）按职责拆成边界清楚的模块——`controller`（决策）/ `render-pipeline`（画图编排）/ `overlays-presenter`（hover/阅读器/面板），并把连接组织收进显式的 `GraphRenderContext`，最后把 `static-renderer.ts` 改名瘦身为 `graph-renderer-root.ts`（组装根）。

这是**纯代码搬家**：不改任何用户可见行为、不做性能优化、不引入新依赖。行为不变由现有 265 个单元测试 + 4 套浏览器回归 + stage-4.5 帧率门槛锁定。

## 源文档

- `docs/spark/2026-06-17-static-renderer-coordination-split-design.md`（本计划的设计来源，含核心原则、共享渲染上下文、模块表）
- `AGENTS.md`、`workbench/CLAUDE.md`（项目规则）
- 上一轮成果：`docs/plans/2026-06-16-graph-six-layer-architecture-phased-plan.md`（六层架构，已合并进 main）

## 规格评审

结论：**可以执行（ready）**。

- 阻塞决策：无。设计已经过 brainstorm + 自审两轮，核心方向（B + 三模块 + 改名 + 停手线 + 共享上下文）已用户确认。
- 已解析的不确定点：
  - `GraphRenderContext` 的字段在本计划 Phase 1.1 定稿（不再是开放项）。
  - `architecture.ts` 是否新增 `controller` 层：本计划决定**新增** `controller` 层 id（见决策记录），因为 controller 是设计中明确的独立 owner。
- 主要漂移风险：把"画图搬家"做成"顺手改逻辑/优化"。本计划把"纯搬家、行为零变化"列为每个 phase 的硬约束。

## 任务规模

L 级 phased plan。理由：跨多个新模块 + 一次大文件改名 + 共享状态重构，有自然阶段边界（建上下文→抽 controller→抽 pipeline→抽 presenter→改名→边界与验收），约 12 个工作单元，预计跨多个 `/goal` turn 与上下文压缩。

## 执行分支策略

实现分支：`feat/graph-renderer-coordination-split`，**从当前 `spark/static-renderer-coordination-split` 创建**（这样实现分支带着设计与本计划文件）。

- 第一项动作（Phase 0.1）：创建该分支并做 clean-start commit（只记录基线，不写功能代码）。
- 不在 `main`、不在 `spark/...` 分支上直接跑实现。
- 不自动 push / merge / amend；合并进 main 需用户复核。

## 执行规则

- 每个工作单元开始前跑基线 smoke check。
- 每完成一个**已验证**工作单元就提交一次，并把提交哈希记进 progress 文件。
- 验证失败不提交。
- 阶段验收通过后直接进入下一阶段，不要求用户逐阶段确认。
- 执行者只能更新 progress 文件的 `status` / `verification` / `evidence` / `commit` / `decision_log` / `turn_log`；不能改写任务定义、验收标准、范围边界。
- 不引入新 npm 依赖、新测试框架。
- 不改 `facade.ts` 公开 API 形状（只更新它对内部函数/类型的引用名）。
- 不动画图零件模块、`gestures.ts`、`viewport.ts`、`state.ts`、`spatial-index.ts`、`hit-testing.ts` 的行为。
- 不顺手重构无关代码、不做性能优化。

## /goal 协议

每次继续工作时：

1. 读 progress 文件，确认当前 phase/task。
2. 跑 `git log --oneline -15` 和基线 smoke check；先修复破损状态再开新工作。
3. 只处理当前工作单元。
4. 验证通过后更新 progress、提交该单元、记录哈希。
5. 阶段验收全部通过后记录并自动进入下一阶段，不询问。

## Progress 文件

`docs/plans/2026-06-17-graph-renderer-coordination-split-progress.json`

## 基线 Smoke Check

每个工作单元开始前运行：

```bash
npm run test --workspace=@llm-wiki/graph-engine
```

若 smoke check 在原始状态已失败，progress 记录失败输出，先修复与本计划相关的破损再开新工作。

## 完整验收命令（最终交付前 + Phase 5）

```bash
npm run test --workspace=@llm-wiki/graph-engine
npm run typecheck --workspace=@llm-wiki/graph-engine
npm run build --workspace=@llm-wiki/graph-engine
npm run test --workspace=@llm-wiki-agent/web
npm run typecheck --workspace=@llm-wiki-agent/web
npm run build --workspace=@llm-wiki-agent/web
bash tests/graph-workbench-interactions.regression-1.sh
bash tests/graph-offline-phase-6.regression-1.sh
bash tests/graph-community-wash-interactions.regression-1.sh
bash tests/graph-browser-stage-4-5.regression-1.sh --target offline
```

改名后的旧责任/旧名清理检查（最终必须通过）：

```bash
# 应无输出：旧文件名与旧函数名已全部清除
rg -n "static-renderer|createStaticGraphRenderer" packages/graph-engine/src packages/graph-engine/test
# 应有输出：新名已就位
rg -n "graph-renderer-root|createGraphRenderer|GraphRenderContext|controller\.ts|render-pipeline\.ts|overlays-presenter\.ts" packages/graph-engine/src
```

> 浏览器回归需 Chrome + Playwright；workbench 目标还需空闲端口 8787 / 5180。若环境无法运行浏览器回归，progress 标记该项 `blocked` 并说明，**不得跳过当作通过**。

### 帧率门槛（性能不退化）

- 硬门槛：`bash tests/graph-browser-stage-4-5.regression-1.sh --target offline` exits 0（脚本内置相对下限）。
- 记录证据：捕获密集图连续缩放的实测 fps，必须 ≥ 45（基线约 50.5，留 10% 波动）。脚本默认清理 artifact，按下法保留后读取：

```bash
cp tests/graph-browser-stage-4-5.regression-1.sh /tmp/s45.sh
sed -i '' "s|tmp_dir=\"\$(mktemp -d)\"|tmp_dir=\"/tmp/s45run\"; mkdir -p \"/tmp/s45run\"|; s|rm -rf \"\$tmp_dir\"|true|; s|REPO_ROOT=\"\$(cd \"\$(dirname \"\$0\")/..\" \&\& pwd)\"|REPO_ROOT=\"$PWD\"|" /tmp/s45.sh
rm -rf /tmp/s45run && bash /tmp/s45.sh --target offline
cat /tmp/s45run/stage-4.5-artifacts/stage-4.5-offline-dense-wheel.json   # 读 "fps" 字段
rm -rf /tmp/s45run /tmp/s45.sh
```

## 实现面地图

### 现有文件（会改）

- `packages/graph-engine/src/render/static-renderer.ts` → 拆出三模块后改名 `graph-renderer-root.ts`
- `packages/graph-engine/src/facade.ts`（更新对 `createGraphRenderer` 的引用名）
- `packages/graph-engine/src/render/index.ts`（更新 re-export）
- `packages/graph-engine/src/architecture.ts`（owner map：新增 controller 层、更新 renderer entrypoints）
- `packages/graph-engine/test/renderer-boundary.test.ts`（更新路径字符串 + 扩展边界测试）

### 新增文件

- `packages/graph-engine/src/render/controller.ts`
- `packages/graph-engine/src/render/render-pipeline.ts`
- `packages/graph-engine/src/render/overlays-presenter.ts`
- `packages/graph-engine/src/render/render-context.ts`（`GraphRenderContext` 定义，或并入 root，实现时定）
- 视需要：`packages/graph-engine/test/controller.test.ts`（若现有测试已覆盖则不强求新增）

### 保持不动

`gestures.ts` / `viewport.ts` / `geometry.ts` / `state.ts` / `spatial-index.ts` / `hit-testing.ts` / `simulation-bridge.ts` / `node-drag-lifecycle.ts` / `keyboard.ts` / 所有画图零件模块（`nodes` `edges` `community-washes` `minimap` `controls` `offline-reader` `hover-card` `toolbar` `legend` `search` `preview` `overlays`）。

### 函数归属（代表清单，私有 helper 随主调用者迁移，按铁律归位）

- **controller.ts**：`applyGestureIntents`、`handleNodeClick`、`focusRenderedNode`、`handleNodeDragStart/Move/End/Cancel`、`handleBlankClick`、`syncRuntimeGestureState`、`runtimeGestureFromActiveGesture`、`bindViewportHandlers`、node-drag 计算 helper（`nodeDragSession`/`nodeDragGrabOffset*`/`nodeDragStartWorldPoint`/`nodeDragWasPinned`/`nodeDragStartSnapshot`/`isRuntimeNodeDrag`/`nodeDragTargetFromScreenPoint`）、语义命令（`selectCommunity`/`focusCommunity`/`resetViewState`/`retreatFocusedView`/`openSearch`/`applySearchQuery`/`focusNextSearchResult`/`closeSearch`/`closeToolbarPanel`）、键盘（`handleDocumentKeydown`/`isGraphKeyboardFocusActive`）、`clearInteractionState`/`clearTransientInteractionForDataRefresh`/`hasInteractionState`。
- **render-pipeline.ts**：`render`（拆成 apply + rebuild/paint 两段）、`paint`、`mountSearchControl`/`mountGraphToolbar`/`mountCommunityLegend`、`applyCommunityHover`、`restartSimulation`/`applyMotionFrame`/`markPinnedNodes`、`commitViewport`/`updateEffectiveDensity`/`renderMotionOverlays`/`updateMinimapViewport`/`setViewportAnimating`、`markDiffElements`/`settleDiffElements`/`animateDiff`、`semanticAnchorForNode`、纯 helper（`positionsFromRenderableGraph`/`setGraphSvgViewBox`/`sameWorldBounds`/`emptyPaintedDom`）。
- **overlays-presenter.ts**：`scheduleHoverPreview`/`showEdgeHoverPreview`/`clearHoverPreview`/`setGraphHover`/`renderHoverPreview`/`positionHoverPreview`/`positionEdgeHoverPreview`、`renderReader`/`renderSelectionPanel`。
- **graph-renderer-root.ts**：`createGraphRenderer`（创建上下文与各模块、接线、返回引擎对象）、对外方法委派、`bindResizeObserver`、`resetRootScroll`、`viewportSize`、选择映射 helper（`rendererSelectionFromRuntimeState`/`panelSelection`/`readerNodeId`，作为共享只读 helper）。

## 架构流向

```text
Browser event -> gestures -> controller(决策) -> 改 state / 通知 simulation
                                            -> 请求重画
render-context(graph/pinState/dom/simulation, 根持有)
  controller/presenter: 只读
  render-pipeline: 重建时写 graph/dom/pinState
render-pipeline(重建模型 + 绘制) -> overlays-presenter(hover/阅读器/面板贴位置)
graph-renderer-root: 组装 + 委派; facade: 公开 API + host 回调
```

## 阶段计划

### Phase 0：基线

目标：在实现分支记录"改之前"的绿色基线，不写功能代码。

任务：

1. `0.1` 从 `spark/static-renderer-coordination-split` 创建 `feat/graph-renderer-coordination-split`，跑基线 smoke check，提交 clean-start progress。
2. `0.2` 跑完整验收命令集 + 帧率捕获，把基线结果（测试数、各命令退出码、实测 fps）记进 progress 的 `baseline` 字段。

验收：

- 当前分支为 `feat/graph-renderer-coordination-split`，工作区无未分离的用户改动。
- `npm run test --workspace=@llm-wiki/graph-engine` exits 0（265 通过）。
- progress 记录 clean-start commit hash 与基线 fps（应 ≈ 50，记录实测值作为后续门槛参照）。

自动前进：记录后进入 Phase 1。

### Phase 1：建立 GraphRenderContext + 抽出 Controller

目标：把连接组织收进显式上下文，把"决策/命令/键盘"搬进 `controller.ts`。

任务：

1. `1.1` 定义 `GraphRenderContext`：持有 `data`/`theme`/`typeFilters`/`graph`/`pinState`/`dom`/`simulation`，文档化读写权（root 创建；render-pipeline 写 `graph`/`dom`/`pinState`；controller/presenter 只读）。把 `static-renderer.ts` 内部从裸闭包变量改为使用上下文对象（机械、行为保持）。
2. `1.2` 抽出 `controller.ts`：搬迁手势意图派发、`handleNode*`/`handleBlankClick`、node-drag 计算 helper、`syncRuntimeGestureState`、`bindViewportHandlers` 接线；`static-renderer.ts` 创建并委派给它。controller 通过上下文只读 `graph`/`pinState`/`dom`，用 state 模块改语义状态，仅在已画元素上切 `is-dragging`/`focus`。
3. `1.3` 把语义命令与键盘路由搬进 controller（`selectCommunity`/`focusCommunity`/`resetViewState`/`retreatFocusedView`/搜索命令/`clearInteraction*`/`handleDocumentKeydown`）。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `bash tests/graph-workbench-interactions.regression-1.sh` exits 0。
- `bash tests/graph-offline-phase-6.regression-1.sh` exits 0。
- `controller.ts` 不含 `paint`/`mount*` 调用、不引用画图零件模块的 `create*`、不计算渲染模型。

自动前进：验收通过并记录后进入 Phase 2。

### Phase 2：抽出 Render-pipeline

目标：把"重建模型 + 绘制"独立成 `render-pipeline.ts`，与"应用改动到 state"分离。

任务：

1. `2.1` 把 `render()` 拆成两段：`applyOptionChanges`（把传入改动写进 state，归 controller/根命令侧）+ `rebuildAndPaint`（重建模型并绘制，归 pipeline，写回上下文 `graph`/`dom`/`pinState`）。行为保持。
2. `2.2` 抽出 `render-pipeline.ts`：搬迁 `rebuildAndPaint`/`paint`/`mount*`/`applyCommunityHover`/相机提交与 `update*`/`restartSimulation`/`applyMotionFrame`/`markPinnedNodes`/diff 动画/`semanticAnchorForNode` 及纯 helper。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `bash tests/graph-workbench-interactions.regression-1.sh` exits 0。
- `bash tests/graph-offline-phase-6.regression-1.sh` exits 0。
- 帧率门槛通过：stage-4.5 offline exits 0 且实测 fps ≥ 45（记进 progress）。
- `render-pipeline.ts` 不调用 gesture 分类、不写 selection/focus/pin 等语义。

自动前进：验收通过并记录后进入 Phase 3。

### Phase 3：抽出 Overlays-presenter

目标：把 hover/边预览/阅读器/选择面板独立成 `overlays-presenter.ts`。

任务：

1. `3.1` 抽出 `overlays-presenter.ts`：搬迁 hover/edge preview（`scheduleHoverPreview`/`showEdgeHoverPreview`/`clearHoverPreview`/`setGraphHover`/`renderHoverPreview`/`position*Preview`）与 `renderReader`/`renderSelectionPanel`；通过 viewport 投影贴锚点、只读 state。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0（含 `overlays.test.ts`/`preview.test.ts`）。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `bash tests/graph-workbench-interactions.regression-1.sh` exits 0（缩放/平移/拖拽/抽屉 resize 后 hover 仍贴目标）。
- `bash tests/graph-offline-phase-6.regression-1.sh` exits 0。
- `overlays-presenter.ts` 不调用 gesture 分类、不写语义状态。

自动前进：验收通过并记录后进入 Phase 4。

### Phase 4：改名 + 瘦身组装根 + 更新 architecture owner map

目标：`static-renderer.ts` 缩成薄组装根并改名；owner map 如实反映新结构。

任务：

1. `4.1` 把 `static-renderer.ts` 改名为 `graph-renderer-root.ts`；导出函数 `createStaticGraphRenderer` → `createGraphRenderer`，公开类型 `StaticGraphRenderer`/`StaticRendererOptions` 一并更名为 `GraphRenderer`/`GraphRendererOptions`；同步更新 `facade.ts`、`render/index.ts`、`renderer-boundary.test.ts`（路径字符串）。确认根文件只剩组装 + 委派。
2. `4.2` 更新 `architecture.ts`：`GraphArchitectureLayerId` 新增 `controller`；`controller` 层 entrypoints 指向 `render/controller.ts`；`renderer` 层 entrypoints 改为 `render/render-pipeline.ts`/`render/overlays-presenter.ts` 及画图零件；`facade`/root 归属相应更新。

验收：

- `npm run test --workspace=@llm-wiki/graph-engine` exits 0（含 `architecture.test.ts`、`renderer-boundary.test.ts`）。
- `npm run typecheck --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run build --workspace=@llm-wiki/graph-engine` exits 0。
- `npm run typecheck --workspace=@llm-wiki-agent/web` exits 0。
- `rg -n "static-renderer|createStaticGraphRenderer" packages/graph-engine/src packages/graph-engine/test` 无输出。
- `bash tests/graph-workbench-interactions.regression-1.sh` 与 `bash tests/graph-offline-phase-6.regression-1.sh` exits 0。

自动前进：验收通过并记录后进入 Phase 5。

### Phase 5：边界测试 + 最终双端验收

目标：用测试锁死铁律，完成完整验收。

任务：

1. `5.1` 扩展 `renderer-boundary.test.ts`（或新增边界测试）：证明 ① `controller.ts` 不引用画图零件 `create*`、不调用 `paint`/`mount*`、不计算渲染模型（**允许** `is-dragging`/`focus` 附着）；② `render-pipeline.ts`/`overlays-presenter.ts` 不调用 gesture 分类、不写语义状态；尽量含一个运行时探针，不只做正则扫描。
2. `5.2` 跑完整验收命令集 + 帧率捕获，记录输出摘要、实测 fps、残余风险；progress 标记 overall completed，记录最后提交哈希。不 push/merge/amend。

验收：

- 完整验收命令集全部 exits 0。
- 帧率 fps ≥ 45 且 ≥ 基线 × 0.9（记进 progress）。
- 旧名清理检查通过；新名就位检查有输出。
- 新边界测试通过。
- progress overall status = completed，residual risk 明确记录。

自动前进：此阶段完成后计划结束。

## 测试与 Eval 计划

- 每 phase：基线 smoke（graph-engine 单测）必过；涉及交互/渲染的 phase（1/2/3/4）加 workbench + offline 浏览器回归。
- Phase 2 与 Phase 5：加 stage-4.5 帧率门槛。
- Phase 5：完整命令集 + community-wash 回归 + 帧率 + 边界测试。
- 不新增测试框架；新边界测试沿用现有 `node:test` 与 `renderer-boundary.test.ts` 模式。

## 已有基础

- `gestures.ts`/`viewport.ts`/`state.ts`/`spatial-index.ts`/`hit-testing.ts` 已是独立 owner，本计划不动其行为。
- 画图零件模块已拆分完成。
- `renderer-boundary.test.ts`/`architecture.test.ts` 已有边界与 owner-map 测试基础，本计划扩展它们。
- 4 套浏览器回归脚本与 stage-4.5 帧率脚本已存在且可运行（offline 已实测 ~50.5fps）。

## 不在范围内

- 不改任何用户可见行为；不做性能优化。
- 不动画图零件模块与 `gestures`/`viewport`/`state`/`spatial-index`/`hit-testing` 的行为。
- 不改 `facade.ts` 公开 API 形状。
- 不引入新依赖、新测试框架。
- 不为凑文件数继续拆碎（守"停手线"：模块就这四个）。
- 不 push / merge / amend。

## 失败模式与残余风险

- 搬家漏接一根线导致行为变化：一次搬一块 + 每块跑单测与 workbench/offline 回归；红了不提交。
- 画图搬错导致视觉/帧率退化：stage-4.5 帧率门槛 + 浏览器回归把关；fps < 45 视为失败。
- 改名遗漏引用：旧名清理检查（rg 无输出）+ typecheck/build 兜底；`renderer-boundary.test.ts`/`architecture.ts` 路径串必须手动同步。
- 模块仍互相伸手（边界不干净）：铁律 + 新边界测试强制"只读上下文 / 请求重画"。
- 以后又把调度塞回画图层：边界测试 + owner map 持续守门。
- 残余风险：`controller` 允许切 `is-dragging`/`focus` 附着，边界测试需精确区分"附着"与"画图"，避免误判或漏判。

## 决策记录

| 决策 | 结论 | 理由 | 否决的替代 |
|---|---|---|---|
| 实现分支 | `feat/graph-renderer-coordination-split`，从 spark 分支创建 | 让实现分支带着设计+计划；符合 repo "代码改动走 feat/ 分支" | 直接在 spark 分支上跑实现 |
| `architecture.ts` 是否加 controller 层 | 新增 `controller` 层 id | controller 是设计中明确的独立 owner，owner map 应如实反映 | 并入 gestures 层描述（会掩盖"决策"独立性） |
| `render()` 处理 | 先拆成 apply + rebuild/paint 两段再迁移 | "应用改动"属命令侧、"重建并画"属 pipeline，混在一起无法干净归属 | 整块塞给 pipeline（违背铁律） |
| 共享状态 | 显式 `GraphRenderContext`，root 持有，pipeline 写、其余只读 | 多文件后裸闭包变量无法跨模块协作；集中避免平行状态岛 | 各模块各持一份引用（易出平行状态） |
| controller 碰 DOM | 允许切 `is-dragging`/`focus` 附着，禁止建/画图 DOM | 真实代码本就如此；强禁会一上手违规且导致过度间接 | 每个 class 切换都包 presenter 方法（过度设计） |
| 帧率门槛 | stage-4.5 offline exits 0 且实测 fps ≥ 45 | 设计要求"≥ 基线（~50）留 10%"；脚本内置相对下限 + 捕获绝对值双保险 | 仅靠脚本相对下限（可能在基线下滑时仍通过） |
| 进度记录粒度 | 按 phase 记一次 | 上一轮逐提交记账过重（115 提交含 58 记账） | 逐提交配 docs progress 提交 |

## 提交规则

- Phase 0.1 做 clean-start commit（仅基线 progress，无功能代码）。
- 每个已验证工作单元提交一次，progress 记哈希。
- 验证失败不提交。
- 不自动 push / merge / amend；合并 main 需用户复核。

## /goal starter

```text
/goal Implement docs/plans/2026-06-17-graph-renderer-coordination-split-phased-plan.md by following its execution ledger.

Each turn:
1. Read docs/plans/2026-06-17-graph-renderer-coordination-split-progress.json, then the current task in the plan.
2. Run `git log --oneline -15` and `npm run test --workspace=@llm-wiki/graph-engine`; repair a broken state before starting new work.
3. Work only on the current work unit. This is a pure code-move: never change user-visible behavior.
4. After verification passes: update the progress file (status, verification, evidence, commit, log fields only); commit that unit; record the commit hash. Never commit on failed verification. Never push, merge, or amend.
5. When a phase's acceptance checks all pass, record it and continue to the next phase without asking for approval.

Done when every item in the plan is complete, every acceptance check is proven, fps >= 45, and the progress file records final status and residual risk.

Stop and report if a product decision is missing, the plan conflicts with the latest direction, or the worktree holds unrelated changes that cannot be safely separated.
```
