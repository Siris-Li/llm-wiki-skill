# 图谱重复 ID 与自动生成 ID 碰撞治理 · 设计文档

- 日期：2026-07-19
- 状态：草案 v2（多视角审查后修订）
- 关联 issue：[#270](https://github.com/sdyckjq-lab/llm-wiki-skill/issues/270)（父票 #269，由 #159 迁移期间发现）
- 分支：`feat/graph-id-collision-governance`
- 目标版本：v3.6.87
- 审查：3 个对抗性子代理（决策最优性 / 可实施性 / 回归风险）审查后修订；修正 6 处事实硬伤 + 3 处方案升级。修正记录见第 13 节。

## 1. 背景

#159（图谱底层 legacy helpers 拆分，已关闭）在迁移时发现：图谱对"重复 ID"和"自动生成 ID 与真实 ID 碰撞"两类问题的处理是历史遗留行为，被有意冻结成契约（`packages/graph-engine/test/fixtures/issue-159/README.md:15` 明确点名 "duplicate and generated IDs … last-write lookup behavior"），长期治理推给 #270。

本设计是 #270 的解决方案。

### 1.1 诊断结论（问题确实存在，审查已复核）

**根因 A：生成端节点 ID = markdown 文件名**

- `scripts/build-graph-data.sh:83`：`id=$(basename "$f" .md)`
- `scripts/build-graph-data.sh:90`：`find "$dir" -type f` 是递归扫描
- 因此 `entities/foo.md` + `topics/foo.md`，或 `synthesis/x.md` + `synthesis/sessions/x.md`（`init-wiki.sh` 默认建嵌套目录）会撞出同一个节点 ID。

**根因 B：引擎层兜底自动 ID 可能撞真实 ID**

- `packages/graph-engine/src/model/atlas.ts:246, 572`：节点缺 id 时补 `node-${index}`
- `packages/graph-engine/src/model/atlas.ts:282, 606`：边缺 id 时补 `edge-${index}`
- 用户若恰好有 `node-1.md`，真实 ID 与自动 ID 撞名。

**根因 C：引擎各子系统"谁覆盖谁"规则不一致（真 bug）**

| 子系统 | 重复 ID 时谁赢 |
|---|---|
| Atlas 建模层 `byId`（`atlas.ts:185`） | 后写覆盖（last-write） |
| summary / select / adapter / render-pipeline / sim / layout（`new Map(arr.map)`） | 先写胜出（first-write） |

后果：同一 ID 在"建模"和"摘要/选择"里可能指向不同对象；度数全算到最后一条；社区成员数虚高；第一个同名节点成为"视觉孤儿"。

**当前行为**：不检测、不报错、不去重数组。

### 1.2 自动 ID 与真实 ID 碰撞

生成端不产生缺失 id 的节点；边 ID = `e<idx>` 自增、按 `(from,to)` 已去重；社区 ID 由 Louvain 从节点 ID 派生。碰撞风险集中在**引擎运行时兜底**（畸形输入、旧离线 HTML 内嵌数据），已被 `runtime-graph-projection.test.ts:34` 的 "legacy generated-ID collisions" 测试锁为契约。

## 2. 目标与非目标

### 目标
1. **阶段一（治 bug）**：引擎层消灭 first/last-write 不一致；自动 ID 物理隔离防撞；告警数据通路打通；重复 ID 输入下图谱不再产生孤儿点/不一致。
2. **阶段二（治本）**：工作台交互式撞名解决——预检 → 弹窗（默认加后缀，可自定义）→ 改名 → 重建，从根上消除重复 ID。
3. 覆盖 #270 验收第 4 条：数据生成、运行时输入、工作台、离线图谱、回归测试。

### 非目标
- 不改变搜索、社区布局、密度、标签、缩放、小地图等用户可见结果（除"重复 ID 不再产生孤儿点 / 不再首末不一致"这一行为变化，以及阶段二改名带来的必然内容切换）。
- 不做实体解析（语义判断两个不同名节点是否同一实体）——超出 #270 范围。
- 不做 wikilink 全自动修复（误指风险高，见 D7）。

## 3. 决策记录

| 编号 | 决策 | 理由 |
|---|---|---|
| **D1** | 生成端撞名：**阶段一**「保留首个 + 强化警告」（lint 风格，列出两个文件完整路径 + 内容摘要）；**阶段二**「工作台交互式重命名」治本 | 阶段一不破坏现有数据（init-wiki.sh 默认嵌套目录就可能撞名，fail-fast 会让新手第一次用就踩坑）；阶段二用 Obsidian/Google Drive 式交互弹窗让用户一键解决，避开 Dropbox 纯自动改名招用户抱怨的坑 |
| **D2** | 引擎层：**入口一次 dedupe + 软告警**（`model.warnings`）；下游 `new Map` 不动 | 入口（`projectGraphInput` / `buildAtlasModel` 的 raw 处理起点）dedupe 后，下游拿到的都是唯一数据，first/last-write 自然等价。这比"替换 11 处建索引点"简单一个数量级，且治本。软告警而非硬失败：引擎服务工作台+离线两宿主，硬失败会让单个坏数据搞挂整个界面 |
| **D3** | baseline：**直接更新 issue-159** `behavior-baseline.json`，并**显式放宽 `README.md:5` 的 "must not regenerate" 契约** | 行为变了就更新契约；但 baseline 里 "duplicate" 散布 187 行/约 20 段、degree/社区/starts/searchIndex 级联，**无法纯脚本批量**，需人工逐段校验。与 README:5 的冲突必须在 ADR 显式声明 |
| **D4** | 自动 ID 前缀：`node-N`/`edge-N` → **`__auto_node_N__`/`__auto_edge_N__`** | 双下划线，markdown 文件名物理上不可能包含，真隔离（`auto-` 前缀只是降低概率，半吊子） |
| **D5** | 告警两路：`meta.warnings`（生成端）+ `model.warnings`（引擎，含 input 透传 + 自产）；`GraphWarning` 补 **`severity`**（error/warning）+ **`source_path`**（定位文件）字段 | 数据与呈现分离；severity 让 duplicate_node_id（用户数据问题）与 generated_id_collision（引擎兜底良性）分级显示；source_path 让用户能定位文件 |
| **D6** | 分两期：**阶段一引擎治理**（治 bug，可独立合并）+ **阶段二工作台交互式重命名**（治本） | 不让"治本的大功能"挡住"治 bug 的小改动"；阶段一几周内落地，阶段二单独做单独验证 |
| **D7** | wikilink 修复：**简版起步**——改名后扫全仓找 `[[旧名]]`，列出 N 处可能受影响链接**提示用户检查**，不自动改 | 全自动修复会"误指"（`[[foo]]` 在不同文件可能指不同 foo，自动判断错就静默指错），误指比断链更危险（断链可见，指错隐藏）。简版零误改风险，用户掌控 |

## 4. 业界依据

- **Neo4j**：`MERGE` + `UNIQUE CONSTRAINT`；明确警告"不要用内部 id 当业务键"。[^1]
- **知识图谱构建**：Normalization → Deduplication → Entity Resolution 标准流程，进图前完成。[^2]
- **Obsidian**（最贴近，同是 markdown 知识库）：允许同名但链接歧义；`NameGuard` 插件创建前阻止重名；链接消歧时自动加路径。改名断 wikilink 是社区核心痛点（印证 D7 谨慎）。[^3]
- **Dropbox**：纯自动加后缀 → 用户强烈抱怨"偷偷改我文件名"（反证 D1 阶段二"弹窗确认"的价值）。[^4]
- **Google Drive**：撞名弹对话框让用户选（D1 阶段二参考模式）。[^5]
- **Cytoscape.js / graphology**：重复 ID 直接渲染失败/抛错——我们引擎现在的"软覆盖"是人为用前置 `new Map` 关掉了 graphology 的硬约束。[^6]

> D2 选"软告警"而非 Neo4j/Cytoscape 式"硬失败"：因引擎服务工作台+离线两宿主，硬失败会让单个坏数据搞挂整个图谱界面。生成端（阶段二）治本后，引擎层只兜畸形输入。

## 5. 架构与数据流

### 阶段一：引擎治理（治 bug）

```
wiki/*.md
  │  ① 生成端（build-graph-data.sh + graph-analysis.js）
  │     撞名 → 保留首个 + 强化警告（lint 风格，列两个文件路径）→ meta.warnings
  ▼
graph-data.json（含 meta.warnings）
  │  ② 引擎层（packages/graph-engine）
  │     入口（projectGraphInput / buildAtlasModel 的 raw 起点一次 dedupe）
  │     → 下游 new Map 拿到的都是唯一数据，first/last-write 自然等价
  │     model.warnings = input.meta.warnings 透传 + 入口 dedupe 自产
  │     自动 ID 前缀 node-N → __auto_node_N__
  ▼
工作台 web（GraphWarningsBanner）/ 离线宿主（轻量提示）
```

### 阶段二：工作台交互式重命名（治本）

```
用户点「重建图谱」
  ↓
① server 跑「撞名预检」（find + basename + uniq -d，快，不构建）
  ↓ 有冲突？
  ├─ 有 → 返回冲突列表，暂停构建
  │     ↓
  │   ② 工作台弹「交互式解决弹窗」
  │      每对：两个文件完整路径 + 内容摘要（标题/首行）
  │      默认：第二个加后缀 foo → foo-2，【一键确定】
  │      用户也可手动输入想要的名字
  │     ↓ 用户确认
  │   ③ server 执行「改名」（rename 文件 + 改 graph-data.json 的 nodes[].id）
  │   ④ wikilink 简版提示：扫全仓 [[旧名]]，列出 N 处可能受影响链接，提示用户检查（不自动改）
  │     ↓
  │   ⑤ 重新构建 → ID 唯一 → 图谱正常
  └─ 无 → 直接构建
```

**降级场景**：
- **离线导出 / CI**（无 UI）：自动用默认加后缀规则 + 警告日志；或要求"先在工作台解决再导出离线"。
- **引擎层兜底**（始终保留）：万一上述流程漏了，阶段一的入口 dedupe + model.warnings 兜底。

## 6. 组件改动清单（文件级）

### 6.1 生成端

| 位置 | 当前 | 改成 |
|---|---|---|
| `scripts/build-graph-data.sh` `scan_kind`（:76-98） | 递归 find，同名都进 `NODES_TSV` | 跨 `scan_kind` 全局 `seen_ids` 关联数组；撞名保留首个、其余记 warning |
| `scripts/build-graph-data.sh` 末尾 jq 拼装（:320-368） | 输出 5 字段 | `--argjson warnings` 注入 `meta.warnings` |
| `scripts/graph-analysis.js` `loadNodeDetails`（:36-58，:54 覆盖） | `byId[id]=node` 后写覆盖 | 首个写入，重复记 warning 不覆盖 |

> 边 ID（`e<idx>`）已按 `(from,to)` 去重，无需额外处理。社区 ID 由节点派生，节点去重后随之唯一。

### 6.2 引擎层（核心：入口一次 dedupe，下游不动）

**新增** `packages/graph-engine/src/model/dedupe.ts`：

```ts
export type GraphWarningCode =
  | 'duplicate_node_id' | 'duplicate_edge_id' | 'duplicate_community_id'
  | 'generated_id_collision';

export type WarningSeverity = 'error' | 'warning';

export interface GraphWarning {
  code: GraphWarningCode;
  severity: WarningSeverity;   // D5 新增：分级
  id: string;
  sourcePath?: string;          // D5 新增：定位文件
  message: string;
}

export function dedupeById<T extends { id: string }>(
  items: T[], warnings: GraphWarning[], code: GraphWarningCode,
): { items: T[]; byId: Map<string, T> };
```

**入口 dedupe（替代原"11 处替换"）**：
- 在 `projectGraphInput`（`atlas.ts:527-566`）和 `buildAtlasModel`（`atlas.ts:178-223`）**各自处理 raw input 的起点**调用 `dedupeById`（或抽 `normalizeGraphInput(raw)` 公共函数，两处复用）。
- 下游 `summary` / `select` / `adapter` / `render-pipeline` / `sim` / `layout` 的 `new Map(arr.map)` **保持不动**——输入唯一后 first/last-write 等价，行为自然正确。

**明确范围声明**（审查发现的归类问题，治不干净就留隐患）：
- 核心节点 byId 主路径（原 spec 列的方向对）：`atlas.ts:185`、`summary/index.ts:264,269-272,316,530`、`select/index.ts:166-167`、`adapter.ts:183-186`、`render-pipeline.ts:489,685`、`render-policy.ts:672`、`sim/index.ts:85`、`layout/spatial-index.ts:131` —— 入口 dedupe 后**不需改**。
- **社区 byId**（`atlas.ts:204` `communityById[id]=community`，与节点 byId 同类 last-write）：**纳入** dedupe 范围。
- **render 层 sigma-\* 系列**（约 15 处 `new Map`：`sigma-graphology-model.ts:106,107,167,168`、`sigma-global-renderer.ts:511,1432,1438` 等）：消费的是已 dedupe 的数据，**不需改**，但需 grep 确认无绕过入口的路径。
- **merge-write**（`anim/index.ts:151-159`，重复 ID 时合并字段而非丢弃）与 **max-merge**（`render-policy.ts:1151`）：**语义不同，不纳入统一去重**，保持现状。
- 剔除原 spec 误列：`atlas.ts:186-188`（社区聚合 push，非 ID 重复处理）、`194-197`（degree 自增，非建索引）。

**自动 ID 前缀**（D4）：`atlas.ts:246, 282, 572, 606`，`node-${i}`/`edge-${i}` → `__auto_node_${i}__`/`__auto_edge_${i}__`。

### 6.3 数据通路 `meta.warnings → model.warnings`（审查发现：当前不通）

需改动（原 spec 低估）：
1. `packages/graph-engine/src/types.ts:45-53` `GraphMeta` 加 `warnings?: GraphWarning[]` + 新增 `GraphWarning` 类型。
2. `atlas.ts:89-94` `AtlasModelMeta` + `atlas.ts:104-114` `AtlasModel` 加 `warnings` 字段。
3. `projectGraphInput`（`atlas.ts:527-566`，**不是** buildAtlasModel）显式拷贝 `rawMeta.warnings` 到 model；同时收集入口 dedupe 自产的 warnings。
4. `facade.ts` 暴露 warnings 给宿主。
5. 可选：`packages/workbench-contracts/src/graph.ts:3-13` `GraphMetaSchema` 显式声明（不声明也不丢，见 6.6）。

### 6.4 工作台（阶段二）

- **server**：
  - 新增「撞名预检」端点：`find` + `basename` + `uniq -d`，返回冲突列表（每对含两个文件路径 + 标题/首行摘要 + 默认建议名）。
  - 新增「执行改名」端点：rename 文件 + 改 `graph-data.json` 的 `nodes[].id`，然后触发重建。
  - wikilink 简版提示端点：扫全仓 `[[旧名]]`，返回可能受影响的链接列表。
- **web**（`workbench/web/src/components/GraphPanel.tsx`，图谱视图主组件）：
  - 新建 `CollisionResolveDialog` 组件（仓库无现成 Dialog，需新建）：列出每对冲突 + 默认加后缀建议 + 用户可改输入框 + 一键确定。
  - 新建 `GraphWarningsBanner` 组件：读 `model.warnings` 展示（阶段一就要）。
  - wikilink 提示组件：改名后展示"N 处链接可能受影响，点击查看"。

### 6.5 离线宿主

- `meta.warnings` 已随 `scripts/build-graph-html.sh` 内嵌进离线 graph-data.json。
- 离线宿主读 `model.warnings`，轻量提示。
- 阶段二交互式重命名**不在离线宿主做**（无 UI），降级为"自动加后缀 + 警告"或"要求先在工作台解决"。

### 6.6 契约与测试（审查发现：原清单不全 + 工作量低估）

**baseline 重写**（`packages/graph-engine/test/fixtures/issue-159/`）：
- `behavior-baseline.json`：`duplicate` 散布 **187 行/约 20 个 snapshot 段**，degree/community node_count/starts/searchIndex/renderable 快照级联变化——**无法纯脚本批量**，需人工逐段校验或重跑生成器。
- `README.md:5` 明文 "must not regenerate that file" → D3 显式声明放宽此契约。
- `behavior-input.json:105` 的 `"from": "node-5"` 是**真实 ID 字面量**（用户文件名），改 `__auto__` 前缀时勿误伤。

**要更新的锁行为测试**（原 spec 漏了 `typed-graph-model.test.ts`，且误列 `facade.test.ts`）：
- `runtime-graph-projection.test.ts:34-72, 99-100`（`node-N` → `__auto_node_N__` 断言）
- `render-policy.test.ts:94-127`
- `summary-contract.test.ts:72-96`
- `typed-graph-model.test.ts:48-57`（**原 spec 漏**：锁 last-write + 数组多条 + degree 累加到最后）
- ~~`facade.test.ts:66-90`~~（**原 spec 误列**：该测试用显式 `node-0` 用户 ID，无缺 id 节点也无两条同 id，不受影响，从清单移除）

**server 透传修正**（原 spec 函数名错）：
- `rebuildGraph`（`workbench/server/src/graph.ts:341-374`）**只 spawn 脚本**，不做透传。
- `readGraphData`（`graph.ts:78-93`，`:85` `JSON.parse`）才透传。
- `GraphDataSchema` 用 `.passthrough()`（`packages/workbench-contracts/src/graph.ts:130-138`），meta 上的 warnings 不会被 strip，会原样到前端。

**新增测试**：
- `dedupe.test.ts`：`dedupeById` 单元测试。
- issue-270 回归测试：撞名输入 → 保留首个 + warnings + degree 正确。
- 阶段二：预检/弹窗/改名/wikilink 提示的端到端测试。

**新增 ADR**：`docs/adr/0033-graph-id-uniqueness-contract.md`（记录 D1–D7 + 业界依据 + baseline 契约放宽）。

**CHANGELOG**：v3.6.87。

## 7. wikilink 简版提示方案（D7）

改名 `topics/foo.md` → `topics/foo-2.md` 后：
1. server 扫全仓 `*.md`，grep `[[foo]]`（含别名/锚点变体，按现有 wikilink 解析规则）。
2. 收集所有命中位置（文件路径 + 行号 + 链接原文）。
3. **不自动改**，作为"待检查链接列表"返回前端。
4. 前端展示：「改名后，以下 N 处链接可能需要更新（它们原本指向旧名 foo）：[列表，每条可点击跳转]」。
5. 用户自行决定每条是否改、改成什么。

> 不做全自动的理由：`[[foo]]` 在不同文件可能指不同 foo（entities/foo 或 topics/foo），自动判断靠启发式，误判则**静默指错**，比断链危险。简版把判断权交还用户。

## 8. 错误处理边界

| 情况 | 处理 | 中断？ |
|---|---|---|
| 生成端撞名（阶段一） | warning：保留首个 + 强化提示 | 否 |
| 工作台撞名（阶段二） | 交互式弹窗，用户确认后改名 | 暂停构建待确认 |
| 引擎重复 ID（畸形/旧数据兜底） | warning：入口 dedupe + model.warnings | 否 |
| 边端点指向不存在节点 | 保持现有过滤（`atlas.ts:191-192`） | 否 |
| 引擎畸形输入（非对象/缺字段） | 保持现有 `objectRecord` 兜底 | 否 |
| 离线/CI 撞名 | 自动加后缀 + 警告日志 | 否 |
| 系统级故障（脚本崩溃、文件不可读） | error | 是 |

**warning 上限**（审查发现：旧离线 HTML 兜底会刷屏）：`model.warnings` 自产部分设上限（如最多 5 条 +「还有 N 条」），避免旧数据（nodes 数组多条重复）触发引擎 dedupe 产生大量警告刷屏。

## 9. 测试方案

- **生成端**：撞名 fixture（两个同名 .md）→ 验证 `NODES_TSV` 只 1 条 + `meta.warnings` 有记录 + 强化警告含两个文件路径。
- **引擎层**：更新 4 个旧测试期望值；`dedupeById` 单元测试；issue-270 回归测试（撞名 → 保留首个 + warnings + degree 在首个累加）。
- **阶段二工作台**：预检 → 弹窗 → 改名 → wikilink 提示端到端。
- **离线**：离线单文件带 warnings → 验证提示；旧离线 HTML（无 warnings）→ 验证不崩 + 兜底 warnings 不刷屏。

## 10. 分阶段实施

### 阶段一：引擎治理（治 bug，可独立合并）
1. 生成端撞名去重 + 强化警告 + `meta.warnings`（6.1）
2. 引擎入口 `dedupeById` + 范围声明（6.2）
3. 数据通路 `meta.warnings → model.warnings`（6.3）
4. `__auto_node_N__` 前缀（D4）
5. 更新 baseline（人工逐段）+ 4 个锁行为测试 + `dedupe.test.ts`（6.6）
6. 工作台 `GraphWarningsBanner`（阶段一就要展示 warnings）
7. ADR-0033 + CHANGELOG

**阶段一完成判定**：重复 ID 输入下，引擎各子系统指向同一对象（first/last-write 等价）；baseline 全绿；warnings 在工作台可见。

### 阶段二：工作台交互式重命名（治本）
1. server 撞名预检 + 执行改名 + wikilink 扫描端点（6.4）
2. web `CollisionResolveDialog` + wikilink 提示组件（6.4）
3. 离线/CI 降级策略（6.5）
4. 端到端测试

> 两期拆分用 `/to-tickets` 落成独立 issue 跟踪。

## 11. 迁移与兼容

- **旧知识库（有同名文件）**：阶段一升级后图谱照常打开（保留首个 + 强化警告）；阶段二后可交互式解决。
- **旧离线 HTML**（内嵌旧 graph-data.json，无 `meta.warnings`，nodes 数组可能含多条重复）：引擎读不到 warnings 视为空数组；入口 dedupe 兜底，但**自产 warnings 有上限**防刷屏（第 8 节）。
- **byId last→first 内容切换**（审查发现，用户可见回归）：升级后，用户点同名节点看到的内容会从"最后写入的文件"变成"最先写入的文件"（entities > topics > sources > ...）。**必须在 ADR-0033 + CHANGELOG 用用户能看懂的话说明**。
- **依赖 `node-N`/`edge-N` 自动 ID 的下游**：仓库内 grep 确认仅测试断言依赖（`runtime-graph-projection.test.ts`、`typed-graph-model.test.ts`），无运行时下游。离线 HTML 内嵌的 id 是用户文件名，非兜底产物，不受前缀变化影响。

## 12. 风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| baseline 重写工作量大（187 行/20 段级联） | 高 | 人工逐段校验；ADR 显式放宽 README:5 "must not regenerate" 契约 |
| 入口 dedupe 范围遗漏（绕过入口的路径） | 中 | grep 全仓 `new Map(.*\.map` + `byId\[` 确认；sigma-* 系列、merge-write 显式声明范围 |
| 旧离线 HTML warnings 刷屏 | 中 | model.warnings 自产部分设上限（第 8 节） |
| byId last→first 内容切换（用户可见） | 中 | ADR + CHANGELOG 明确说明语义切换 |
| 阶段二 wikilink 简版仍需用户手动检查 | 低 | 设计如此（D7，避免全自动误指）；未来可升级 |
| `CollisionResolveDialog` 与现有 UI 风格冲突 | 低 | 实现阶段参考 GraphPanel 现有视觉惯例 |

## 13. 审查发现与修正记录（v1 → v2）

本次修订由 3 个对抗性子代理审查驱动：

**事实硬伤（6 处，已修）**：
1. 「11 处建索引点」数字与归类错（实际 17-34 处，混入 ID 生成点/社区聚合/degree 自增）→ 改为「入口一次 dedupe + 范围声明」。
2. baseline 重写工作量低估（187 行/20 段级联）+ 与 `README.md:5` 冲突 → D3 显式声明放宽契约。
3. `meta.warnings → model.warnings` 当前不通（GraphMeta/AtlasModel 无字段，函数名 buildAtlasModel 错）→ 6.3 列全改动。
4. 漏 `typed-graph-model.test.ts:48-57` → 补进测试清单。
5. 误列 `facade.test.ts:66-90`（测投影缓存，不受影响）→ 从清单移除。
6. server 透传挂错函数（rebuildGraph 只 spawn，readGraphData 才透传）→ 6.6 修正。

**方案升级（3 处，用户拍板）**：
- D1：从「保留首个 + 警告」升级为「阶段一保留首个强化警告 + 阶段二工作台交互式重命名」（用户想法，避 Dropbox 坑）。
- D4：从 `auto-` 前缀升级为 `__auto_node_N__` 物理隔离（红队指出 auto- 是半吊子）。
- 引擎层：从「替换 11 处建索引点」改为「入口一次 dedupe」（红队指出过度防御，治症状不治病因）。

**新增**：D7 wikilink 简版提示（用户拍板，不做全自动）；warning 上限（防旧 HTML 刷屏）；byId 内容切换的迁移说明。

## 14. 参考

[^1]: [Neo4j: Graph Data Modeling — All About Keys](https://medium.com/neo4j/graph-data-modeling-keys-a5a5334a1297)；[Neo4j Community: MERGE vs CREATE](https://community.neo4j.com/t/duplicate-nodes-but-with-different-graph-ids/13296)
[^2]: [Knowledge Graphs: Normalization, Deduplication, and Entity Resolution](https://medium.com/@QuarkAndCode/knowledge-graphs-normalization-deduplication-and-entity-resolution-a8ba384d539c)
[^3]: [Obsidian: Note with same name exists in another folder](https://forum.obsidian.md/t/warning-note-with-same-name-exists-in-another-folder/35549)；[NameGuard plugin](https://community.obsidian.md/plugins/name-guard)
[^4]: [Dropbox keeps changing my file names](https://www.reddit.com/r/dropbox/comments/y52t9t/help_dropbox_keeps_changing_my_file_names/)
[^5]: [Why does Google Drive use a dialog for renaming files?](https://ux.stackexchange.com/questions/95794/why-does-google-drive-use-a-dialog-for-renaming-files)
[^6]: [Cytoscape.js: redundant edges](https://stackoverflow.com/questions/47634974/cytoscape-js-redundant-edges)

仓库内证据见第 1 节与第 6 节的文件:行号。
