# static-renderer 协调逻辑拆分设计

日期：2026-06-17
状态：待用户复核
分支：`spark/static-renderer-coordination-split`（基于 main `f8a834d`）
路线：B —— 抽出 Controller，并把渲染侧按职责拆到位

## 目的

上一轮"图谱六层架构"重构（已合并进 main）把图谱的**决策权**收敛到了正确的模块：手势归 `gestures.ts`、坐标归 `viewport.ts`/`geometry.ts`、命中归 `spatial-index.ts`/`hit-testing.ts`、状态归 `state.ts`，画图零件也拆成了 `nodes.ts`/`edges.ts`/`community-washes.ts`/`minimap.ts` 等独立模块。

但有一块没收尾：`packages/graph-engine/src/render/static-renderer.ts` 仍有 **2481 行**，同时承担了**四种不同职责**——组装、调度指挥、画图编排、对外接口。它名叫"renderer"（渲染器），实际却是事实上的"总指挥"。这是六层设计原本想达到、但没做到的一块（设计原文要求"GraphRenderer 只负责画图"）。

本设计的目标：把这块"既指挥又画图"的混合体，按职责拆成边界清楚的模块，让"做决定的"和"画图的"彻底分开，且**以后新增交互时不会再把逻辑塞回画图层**。

这不是性能优化。当前图谱性能良好（见下方性能基线）。这是纯粹的代码结构整理，**不改变任何用户可见行为**。

## 现状（事实，带证据）

`static-renderer.ts`（2481 行）内部混着四类东西：

1. **组装**：`createStaticGraphRenderer()` 创建 root 元素、gestures 控制器、runtime state、hit resolver、pin state、simulation、resize observer，并把它们接线。
2. **调度指挥**：`applyGestureIntents()` 把手势意图派发给 `handleNodeClick` / `handleNodeDragStart` / `handleNodeDragMove` / `handleNodeDragEnd` / `handleNodeDragCancel` / `handleBlankClick`；以及语义命令 `selectCommunity` / `focusCommunity` / `resetViewState` / `retreatFocusedView` / `openSearch` / `applySearchQuery` / `closeSearch` / `clearInteractionState`；还有键盘意图路由 `handleDocumentKeydown`。
3. **画图编排**：`render()`（重建渲染模型→重绘→挂控件→提交相机→画 overlay→重启模拟）、`paint()`（把画图零件拼成 DOM 树）、`mountSearchControl` / `mountGraphToolbar` / `mountCommunityLegend`、`commitViewport` / `updateMinimapViewport` / `updateEffectiveDensity`、diff 动画 `markDiffElements` / `settleDiffElements` / `animateDiff`。
4. **hover / 阅读器 / 选择面板**：`scheduleHoverPreview` / `showEdgeHoverPreview` / `clearHoverPreview` / `renderHoverPreview` / `positionHoverPreview` / `positionEdgeHoverPreview` / `renderReader` / `renderSelectionPanel`。
5. **对外接口**：返回的对象（`render` / `applyDiff` / `setData` / `setTheme` / `setPins` / `focusNode` / `focusCommunity` / `resetView` / `select` / `clearSelection` / `clearInteraction` / `resetLayout` / `destroy`），由 `facade.ts` 包装成公开 API。

基线（实测）：单元测试 265 个全部通过；密集图（200 节点 / 231 边）连续缩放稳定约 50.5 fps。

## 核心原则（这是"不会再返工"的关键）

1. **铁律**：Controller 只做决定、不碰画图 DOM；Render-pipeline 只画图、不做手势/命令决定。两者只通过"读状态 / 请求重画"交互，不互相伸手进对方内部。
2. **停手线**：模块就定下面这几个，每个对应一个明确职责。拆到这个粒度就**停手**，不再为了凑文件数继续切碎。这是成熟标准——按职责拆到位，既不留 god 文件，也不拆成 confetti 碎片。
3. **纯搬家**：本次只移动和重组代码，不改逻辑、不改行为。任何"顺手优化"都不在范围内。

## 目标模块结构

`gestures.ts` / `viewport.ts` / `state.ts` / `spatial-index.ts` / `hit-testing.ts` 以及所有画图零件模块（`nodes.ts` / `edges.ts` / `community-washes.ts` / `minimap.ts` / `controls.ts` / `offline-reader.ts` / `hover-card.ts` / `toolbar.ts` / `legend.ts` / `search.ts` / `preview.ts`）**保持不动**。本次只新增/重组下面的协调与编排层：

| 模块（文件） | 职责（一句话） | 拥有的代表函数 | 允许依赖 | 禁止 |
|---|---|---|---|---|
| `controller.ts`（新） | 总指挥：把手势意图和 API 命令翻译成"该改什么状态/模拟/相机，然后请求重画" | `applyGestureIntents`、`handleNode*`、`handleBlankClick`、语义命令（select/focus/reset/search/clear）、键盘意图路由、node-drag 计算 helper | `state`、`viewport`、`gestures`、`simulation-bridge`、`node-drag-lifecycle`、`hit-testing`、`keyboard` | 直接创建/操作画图 DOM；直接调用 host 回调以外的渲染细节 |
| `render-pipeline.ts`（新） | 画图编排：照当前状态把图重绘出来 | `render`、`paint`、`mount*`、`commitViewport`、`update*`、diff 动画、`restartSimulation`/`applyMotionFrame` 等绘制编排 | 所有画图零件模块、`state`（只读）、`viewport`（投影） | 判断手势意义；写入交互决策 |
| `overlays-presenter.ts`（新） | hover 卡片 / 边预览 / 阅读器 / 选择面板的"贴位置 + 显示" | `scheduleHoverPreview`、`showEdgeHoverPreview`、`clearHoverPreview`、`renderHoverPreview`、`position*Preview`、`renderReader`、`renderSelectionPanel` | `overlays.ts`（锚点）、`preview.ts`、`hover-card.ts`、`viewport`、`state`（只读） | 判断手势意义；决定状态 |
| `graph-renderer-root.ts`（由 `static-renderer.ts` 改名瘦身） | 组装根：创建上述模块、接线，返回供 facade 包装的引擎对象 | `createGraphRenderer()`（原 `createStaticGraphRenderer`）、`destroy`、对外方法的委派 | 上述所有协调/编排模块 | 自己实现调度或画图细节（只做组装与委派） |

说明：`controller.ts` 同时拥有"手势触发的处理"和"API 命令（如 `focusCommunity`/`resetView`）"，因为它们是同一职责——"对一个动作做出决定"。把它们合在一个模块，正是为了守住"停手线"，不再过度拆分。

## 数据流

拖动节点：

```
你拖节点
  -> gestures 翻译成"拖拽意图"
  -> controller 决定：更新该节点位置、固定它、改 state、通知 simulation
  -> controller 请求重画
  -> render-pipeline 照新状态把节点画到新位置
  -> overlays-presenter 把 hover 卡片贴回正确锚点
```

API 命令（如宿主调用 `focusCommunity`）：

```
facade.focusCommunity(id)
  -> graph-renderer-root 委派给 controller
  -> controller 改 focus state、请求重画
  -> render-pipeline 重绘聚焦视图
```

每一层只干自己那段；出问题能立刻定位是"指挥错了"还是"画错了"。

## 命名决策

- 文件 `render/static-renderer.ts` → `render/graph-renderer-root.ts`（它以后只管组装，名字应说明这一点）。
- 对外函数 `createStaticGraphRenderer` → `createGraphRenderer`（"static" 是早期遗留词，已无意义）。
- 影响面约 6 处引用：`facade.ts`、`render/index.ts`、`sim/index.ts`、`sim/pins.ts`、`architecture.ts`、`renderer-boundary.test.ts`。全部由测试兜底。
- `architecture.ts` 中 `renderer` 层的 `entrypoints` 需相应更新；新增 `controller` 层条目（见下）。

`architecture.ts` 调整：当前六层 owner map 把 `static-renderer.ts` 归在 `renderer` 层。重组后：
- `renderer` 层 entrypoints 指向 `render-pipeline.ts`、`overlays-presenter.ts` 及画图零件；不再把组装/调度算作 renderer。
- 视实现情况，将"调度"明确为 `gestures` 层的下游协调，或在 owner map 中体现 `controller.ts` 的归属（实现时确定：要么并入 `gestures` 层描述，要么新增一层条目）。原则是 owner map 必须如实反映"谁做决定、谁画图"。

## 迁移计划（一次搬一块，每块跑全套测试才提交）

沿用上一条分支的纪律：每个工作单元完成并验证通过才提交，红了不提交，不自动 push/merge/amend。

- **Phase 0 基线**：跑全套单元测试 + 4 套浏览器回归 + 帧率测试，记录"改之前是绿的、约 50fps"。不写功能代码。
- **Phase 1 抽 Controller**：把调度/命令/键盘路由搬进 `controller.ts`，`static-renderer.ts` 改为创建并调用它。跑测试。
- **Phase 2 抽 Render-pipeline**：把 `render()`/`paint()`/挂控件/相机提交/diff 动画搬进 `render-pipeline.ts`。跑测试。
- **Phase 3 抽 Overlays-presenter**：把 hover/边预览/阅读器/选择面板搬进 `overlays-presenter.ts`。跑测试。
- **Phase 4 收尾与改名**：`static-renderer.ts` 缩成薄组装根并改名为 `graph-renderer-root.ts`；函数改名 `createGraphRenderer`；更新引用与 `architecture.ts`；补充清晰注释。跑测试。
- **Phase 5 边界测试与总验收**：新增/扩展边界测试锁死铁律；跑完整验收命令集 + 帧率对比基线。

## 测试与安全策略

- **安全网**：现有 265 个单元测试 + 4 套浏览器回归（workbench / offline / community-wash / stage-4.5 perf）每个 phase 都必须全绿。因为是纯搬家，"行为不变"由这些既有测试保证。
- **性能门槛**：收尾重跑 stage-4.5 密集图帧率测试，fps 必须 ≥ 基线（约 50fps，允许 10% 波动）；低于则不通过。
- **新增边界测试**（锁死铁律，防止以后回潮）：
  - `controller.ts` 不引用画图零件模块、不直接创建画图 DOM。
  - `render-pipeline.ts` / `overlays-presenter.ts` 不调用 gesture 分类、不写交互决策。
  - 尽量包含一个运行时探针（仿照现有 `renderer-boundary.test.ts`），不只做源码正则扫描。
- **进度记录从简**：上一轮"每个代码提交都配一个进度记账提交"过重。本次按 phase 记一次即可，不要求逐提交记账。

## 性能基线（实测）

| 场景 | 数据 | 结果 |
|---|---|---|
| 密集图连续缩放 | 200 节点 / 231 边，桌面 1440×960，采样 3 秒 | 50.5 fps（空闲基线 12.6 仅因无动画时不刷帧，属正常）|

来源：`tests/graph-browser-stage-4-5.regression-1.sh --target offline`。

## 不在范围内

- 不改任何用户可见行为。
- 不做性能优化（当前不卡）。
- 不动画图零件模块、`gestures.ts`、`viewport.ts`、`state.ts`、`spatial-index.ts`。
- 不动 `facade.ts` 的公开 API 形状（只更新它对内部函数的引用名）。
- 不引入新依赖、新测试框架。
- 不顺手重构无关代码。
- 不切 WebGL / 不改图谱数据结构 / 不改知识库 markdown。
- 不为了凑文件数把模块继续拆碎（守"停手线"）。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 搬家时漏接一根线导致行为变化 | 一次只搬一块，每块跑全套测试；红了不提交 |
| 画图搬错导致视觉/帧率退化 | stage-4.5 帧率门槛 + 浏览器回归把关 |
| 改名牵动多处引用 | 影响面已知（约 6 处），测试兜底；改名集中在 Phase 4 一次做完 |
| 以后又把调度塞回画图层 | 新增边界测试 + owner map 如实更新 |
| 模块边界划得不够干净（仍互相伸手） | 铁律 + 边界测试强制"只读状态 / 请求重画"的交互方式 |

## 验收标准

1. `static-renderer.ts` 已改名为 `graph-renderer-root.ts`，且只剩组装与委派，不含调度决策或画图编排细节。
2. `controller.ts` / `render-pipeline.ts` / `overlays-presenter.ts` 三个模块各自职责单一、边界清楚。
3. 265 个单元测试 + 4 套浏览器回归全绿。
4. 密集图帧率 ≥ 基线（约 50fps）。
5. 新边界测试通过，证明 Controller 不画图、Render-pipeline/Overlays 不做决定。
6. `architecture.ts` owner map 如实反映新结构。
7. 全程行为零变化（由既有测试保证）。

## 开放问题（实现时确定，不阻塞本设计）

1. `controller.ts` 在 `architecture.ts` 里是并入 `gestures` 层描述，还是新增独立层条目。
2. 语义命令（select/focus/reset/search）全部归 `controller.ts`，还是其中纯 UI 面板开关（如 toolbar 折叠）留在 `render-pipeline.ts`——以"是否构成交互决策"为判据，实现时按铁律归位。
