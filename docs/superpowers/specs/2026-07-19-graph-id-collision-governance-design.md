# 图谱重复 ID 与自动生成 ID 碰撞治理 · 设计文档

- 日期：2026-07-19
- 状态：草案（待 review）
- 关联 issue：[#270](https://github.com/sdyckjq-lab/llm-wiki-skill/issues/270)（父票 #269，由 #159 迁移期间发现）
- 分支：`feat/graph-id-collision-governance`
- 目标版本：v3.6.87

## 1. 背景

#159（图谱底层 legacy helpers 拆分，已关闭）在迁移时发现：图谱对"重复 ID"和"自动生成 ID 与真实 ID 碰撞"两类问题的处理是历史遗留行为，被有意冻结成契约（`packages/graph-engine/test/fixtures/issue-159/README.md:15` 明确点名 "duplicate and generated IDs … last-write lookup behavior"），长期治理推给 #270。

本设计是 #270 的解决方案。

### 1.1 诊断结论（问题确实存在）

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

后果：同一 ID 在"建模"和"摘要/选择"里可能指向不同对象；度数全算到最后一条；社区成员数虚高；第一个同名节点成为"视觉孤儿"（画了但点不动）。

**当前行为**：不检测、不报错、不去重数组。靠每个子系统各自的 Map/Record "软收敛"，但因 first/last-write 不一致而存在真正的一致性缺口。

### 1.2 自动 ID 与真实 ID 碰撞

生成端不产生缺失 id 的节点（id 恒为文件名）；边 ID = `e<idx>` 自增、按 `(from,to)` 已去重；社区 ID 由 Louvain 从节点 ID 派生。因此生成端正常流程下不撞。碰撞风险集中在**引擎运行时兜底**（畸形输入、对象顺序、旧离线 HTML 内嵌数据），已被 `runtime-graph-projection.test.ts:34` 的 "legacy generated-ID collisions" 测试锁为契约。

## 2. 目标与非目标

### 目标
1. 生成端从根上消除重复节点 ID（撞名保留首个 + 告警）。
2. 引擎层把 11 处各自建索引的点统一为"保留首个"，消灭 first/last-write 不一致。
3. 自动 ID 兜底前缀加 `auto-`，杜绝与真实 ID 碰撞。
4. 告警端到端可见：`graph-data.json` → 引擎 model → 工作台 / 离线宿主界面。
5. 覆盖 #270 验收第 4 条：数据生成、运行时输入、工作台、离线图谱、回归测试。

### 非目标
- 不改变搜索、社区布局、密度、标签、缩放、小地图等用户可见结果（除"重复 ID 不再产生孤儿点 / 不再首末不一致"这一行为变化外）。
- 不重写图谱引擎架构，不新增图谱功能。
- 不处理"实体解析"（语义层面判断两个不同名节点是否同一实体）——那是 KG 领域更大的课题，超出 #270 范围。

## 3. 决策记录

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 生成端撞名 → **保留首个 + 警告** | 迁移代价最低，旧知识库升级后仍能打开；生成端先治本，引擎层再兜底 |
| D2 | 引擎层重复 ID → **统一去重（保留首个）+ 软告警** | 消灭 first/last-write 不一致 bug；容错不搞挂界面 |
| D3 | baseline → **直接更新 issue-159** `behavior-baseline.json` | issue-159 已关闭，baseline 是"当前行为契约"，行为变了就更新，不保留旧契约 |
| D4 | 自动 ID 前缀 → `node-N`/`edge-N` 改 `auto-node-N`/`auto-edge-N` | 真实文件名几乎不以 `auto-` 开头，从根上杜绝碰撞，改动极小 |
| D5 | 告警两路 → `graph-data.json` 的 `meta.warnings` + 引擎 `model.warnings`，宿主读取后界面提示 | 数据与呈现分离，工作台 / 离线宿主共用一套 |
| D6 | 分两阶段 → 阶段一治本+消灭 bug；阶段二告警 UI/前缀/契约/ADR/CHANGELOG/回归 | 先保证正确性闭环，再补用户可见呈现与文档 |

## 4. 业界依据

D1 + D2 的组合对应业界"源头 MERGE 去重 + 运行时唯一性约束"的主流做法：

- **Neo4j**：`MERGE`（非 `CREATE`）避免重复 + `UNIQUE CONSTRAINT` 兜底；明确警告"不要用内部 id 当业务键，要自己生成稳定唯一键"（对应我们的"文件名当键"根因）。[^1]
- **知识图谱构建**：标准流程 Normalization → Deduplication → Entity Resolution，全部在"进图前"完成。重复 ID 是"进图前就该解决"的问题。[^2]
- **图可视化库**：Cytoscape.js 遇重复 ID 直接渲染失败；Sigma/graphology 的 `addEdgeWithKey` 本就对重复 key 抛错——我们引擎现在的"软覆盖"实际是人为用前置 `new Map` 关掉了 graphology 的硬约束。[^3]
- **数据工程（MDM）**：fail-fast（唯一约束）与 post-hoc dedup 的经典权衡，业界共识是两层结合。[^4]

> 注：D2 选择"软告警"而非 Neo4j 式"硬失败"，是因为引擎同时服务工作台与离线宿主，硬失败会让单个坏数据搞挂整个图谱界面，与 #270 验收第 5 条（不破坏既有知识库可用性）冲突。生成端已治本，引擎层只需兜底 + 告警。

## 5. 架构与数据流

```
wiki/*.md
  │  ① 生成端（build-graph-data.sh + graph-analysis.js）
  │     撞名 → 保留首个 + 记 warning
  ▼
graph-data.json  ← 新增 meta.warnings
  │  ② 引擎层（packages/graph-engine）
  │     dedupeById 统一"保留首个" → 消灭 first/last-write 不一致
  │     model.warnings 收集重复/碰撞告警
  │     自动 ID 前缀 node-N → auto-node-N
  ▼
工作台 web（GraphWarningsBanner）  /  离线宿主（轻量提示）
```

### 撞名场景端到端

```
wiki: entities/foo.md + topics/foo.md
  ↓ build-graph-data.sh
scan entities → foo 入表, seen[foo]=entities/foo.md
scan topics   → foo 已存在 → 记 warning, 不入表
  ↓ graph-analysis.js
byId[foo] 首个写入（生成端已治，无重复）
  ↓ 输出 graph-data.json
nodes: [{id:foo, ...}]（1 条）
meta.warnings: [{code:'duplicate_node_id', id:'foo', kept:'entities/foo.md', dropped:['topics/foo.md']}]
  ↓ 引擎 buildAtlasModel（浏览器端 createGraphEngine 内）
dedupeById(nodes) → 1 条 + byId（畸形输入由这里兜底记 warning）
读取 input.meta.warnings 透传 + 合并引擎自产 → model.warnings
  ↓ 宿主（GraphPanel 读 model.warnings）
GraphWarningsBanner：「节点 ID 'foo' 重复，已保留 entities/foo.md，忽略 1 个同名文件」
```

## 6. 组件改动清单（文件级）

### 6.1 生成端

| 位置 | 当前 | 改成 |
|---|---|---|
| `scripts/build-graph-data.sh` `scan_kind`（:76-98） | 递归 find，同名都进 `NODES_TSV` | 维护跨 `scan_kind` 的全局 `seen_ids` 关联数组；撞名保留首个、其余记进 `WARNINGS` |
| `scripts/build-graph-data.sh` 末尾 jq 拼装（:320-368） | 输出 `meta/nodes/edges/learning/insights` | 用 `--argjson warnings` 注入 `meta.warnings` |
| `scripts/graph-analysis.js` `loadNodeDetails`（:36-58，:54 覆盖） | `byId[id]=node` 后写覆盖 | 首个写入，重复记 warning 不覆盖；warnings 透传到输出 |

边 ID（`e<idx>`）已按 `(from,to)` 去重，无需额外处理。社区 ID 由节点派生，节点去重后随之唯一。

> "首个"指构建扫描顺序中先出现者：生成端由 `scan_kind` 调用顺序（entities→topics→sources→comparisons→synthesis→queries）叠加 `LC_ALL=C sort` 决定；引擎层指数组顺序第一个。两端语义一致（都是"先到先得"）。

### 6.2 引擎层

**新增** `packages/graph-engine/src/model/dedupe.ts`：

```ts
export type GraphWarningCode =
  | 'duplicate_node_id'
  | 'duplicate_edge_id'
  | 'duplicate_community_id'
  | 'generated_id_collision';

export interface GraphWarning {
  code: GraphWarningCode;
  id: string;
  message: string;
}

// 保留首个；重复项记 warning；返回去重后的数组与索引
export function dedupeById<T extends { id: string }>(
  items: T[],
  warnings: GraphWarning[],
  code: GraphWarningCode,
): { items: T[]; byId: Map<string, T> };
```

**替换 11 处建索引点**（全部改为"保留首个"）：

| 文件:行 | 当前 |
|---|---|
| `atlas.ts:185`（byId 后写覆盖）、`:186-188`（groupedByCommunity push）、`:195-196`（degree 累加） | last-write |
| `summary/index.ts:264, 316, 530`、`:269-272`（firstEdgeById） | new Map 首个 |
| `select/index.ts:166-167` | new Map 首个 |
| `render/adapter.ts:183-186` | new Map 首个 |
| `render/render-pipeline.ts:489, 685` | new Map 首个 |
| `render/render-policy.ts:672`（pointById 共享坐标 → 重叠点消失） | new Map 首个 |
| `sim/index.ts:85`、`layout/spatial-index.ts:131` | new Map 首个 |

> 关键行为变化：去重后**数组也只留首个**（当前数组保留多条）。degree 在去重后的首个对象上累加。

**自动 ID 前缀**：`atlas.ts:246, 282, 572, 606`，`node-${i}`/`edge-${i}` → `auto-node-${i}`/`auto-edge-${i}`。

**model 顶层**：加 `warnings: GraphWarning[]`，由 `buildAtlasModel` 收集；两类来源——(a) 读取 input 的 `meta.warnings`（生成端产出）并透传，(b) 引擎 `dedupeById` 自产（畸形输入兜底）。facade 暴露给宿主。引擎 input 类型（`GraphData`）的 `meta` 增补 `warnings?` 子字段。

### 6.3 工作台

- `workbench/server/src/graph.ts` `rebuildGraph`（:341-374）：仅透传 graph-data.json（`meta.warnings` 已在其中，server 不单独处理；server 只 `JSON.parse` + 类型化为 `GraphData` 传给前端，不经引擎 facade）。
- `workbench/web/src/components/GraphPanel.tsx`（图谱视图主组件，浏览器端 `createGraphEngine` 实例化引擎）：新建轻量 `GraphWarningsBanner` 组件（仓库无现成 Banner/Toast，需新建），置于 `GraphPanel` 容器顶部，读引擎 facade 暴露的 `model.warnings` 显示。

### 6.4 离线宿主

- `meta.warnings` 已随 `scripts/build-graph-html.sh` 内嵌进离线 graph-data.json。
- 离线宿主读 `model.warnings`，在离线图谱界面加同样的轻量提示（具体落点在实现计划阶段定位）。

### 6.5 契约与测试

- 更新 `packages/graph-engine/test/fixtures/issue-159/`：
  - `behavior-baseline.json`：重复 ID 期望值（多条 → 1 条 + `warnings`）
  - `behavior-input.json`：撞名输入样本（已有 duplicate 样本，按新语义校准）
  - `README.md:15`：契约说明 "last-write lookup behavior" → "first-write dedupe + warnings"
- 更新 4 个锁行为的测试期望值：
  - `runtime-graph-projection.test.ts:34-72, 99-100`（含 `node-N` → `auto-node-N` 断言）
  - `render-policy.test.ts:94-127`
  - `summary-contract.test.ts:72-96`
  - `facade.test.ts:66-90`
- 新增：
  - `packages/graph-engine/test/dedupe.test.ts`：`dedupeById` 单元测试
  - issue-270 回归测试：撞名输入 → 保留首个 + `warnings` + degree 正确
- 新增 `docs/adr/0033-graph-id-uniqueness-contract.md`：记录 D1–D4 决策与业界依据。
- CHANGELOG v3.6.87。

## 7. 错误处理边界

| 情况 | 处理 | 中断？ |
|---|---|---|
| 生成端撞名 | warning：保留首个 + 提示 | 否 |
| 引擎重复 ID（畸形/旧数据兜底） | warning：保留首个 + `model.warnings` | 否 |
| 边端点指向不存在节点 | 保持现有过滤（`atlas.ts:191-192`） | 否 |
| 引擎畸形输入（非对象/缺字段） | 保持现有 `objectRecord` 兜底 | 否 |
| 系统级故障（脚本崩溃、文件不可读） | error | 是 |

**原则**：用户数据问题永远不当 error（不搞挂图谱界面），只当 warning。仅系统级故障中断。

## 8. 测试方案

- **生成端**：撞名 fixture（两个同名 .md）→ 验证 `NODES_TSV` 只 1 条 + `meta.warnings` 有记录。
- **引擎层**：
  - 更新 4 个旧测试期望值（新行为）
  - issue-270 回归测试（撞名 → 保留首个 + warnings + degree 正确）
  - `dedupeById` 单元测试（含空输入、全唯一、全重复、混合）
- **端到端**：工作台构建带撞名的知识库 → 验证 `GraphWarningsBanner` 出现。
- **离线**：离线单文件图谱带 warnings → 验证提示展示。

## 9. 分阶段实施

### 阶段一：治本 + 消灭 bug
1. 生成端撞名去重 + `meta.warnings`（6.1）
2. 引擎 `dedupeById` 工具 + 替换 11 处建索引点（6.2）
3. `model.warnings` 数据通路（生成端 → 引擎 → 宿主可读）
4. 更新现有 baseline 与 4 个锁行为测试

**阶段一完成判定**：重复 ID 输入下，引擎各子系统指向同一对象；baseline 全绿。

### 阶段二：呈现 + 收尾
1. `auto-` 前缀（D4）
2. 工作台 `GraphWarningsBanner` + 离线宿主提示（6.3 / 6.4）
3. `dedupe.test.ts` + issue-270 回归测试
4. ADR-0033
5. CHANGELOG v3.6.87
6. 端到端验收

## 10. 迁移与兼容

- 旧知识库（有同名文件）：升级后图谱照常打开，撞名节点保留首个，界面提示被忽略的文件。**无破坏性**。
- 旧离线 HTML（内嵌旧 graph-data.json，无 `meta.warnings`）：引擎读不到 warnings 视为空数组，正常显示。
- 依赖 `node-N`/`edge-N` 自动 ID 的下游（若有）：需同步改为 `auto-node-N`/`auto-edge-N`。仓库内 grep 确认仅测试断言依赖，无运行时下游。

## 11. 风险

| 风险 | 缓解 |
|---|---|
| baseline 重写工作量大（`behavior-baseline.json` 151KB） | 用脚本批量更新重复 ID 相关期望，其余字段不动 |
| 替换 11 处建索引点可能遗漏 | 以 `grep 'new Map(.*\.map'` + `forEach.*byId\[` 全量扫描确认覆盖 |
| 自动 ID 前缀变化影响其他测试 | 全仓 grep `node-\|edge-` 锁定依赖点，一并更新 |
| `GraphWarningsBanner` 可能与现有 UI 风格冲突 | 实现阶段参考现有图谱视图容器的视觉惯例 |

## 12. 参考

[^1]: [Neo4j: Graph Data Modeling — All About Keys](https://medium.com/neo4j/graph-data-modeling-keys-a5a5334a1297)；[Neo4j Community: MERGE vs CREATE](https://community.neo4j.com/t/duplicate-nodes-but-with-different-graph-ids/13296)
[^2]: [Knowledge Graphs: Normalization, Deduplication, and Entity Resolution](https://medium.com/@QuarkAndCode/knowledge-graphs-normalization-deduplication-and-entity-resolution-a8ba384d539c)
[^3]: [Cytoscape.js: redundant edges](https://stackoverflow.com/questions/47634974/cytoscape-js-redundant-edges)
[^4]: [Ways to Handle Data Duplication (fail-fast vs dedup)](https://medium.com/@tuananhbk1996/ways-to-handle-data-duplication-in-event-systems-practical-patterns-and-trade-offs-c6be9d176b41)

仓库内证据见第 1 节与第 6 节的文件:行号。
