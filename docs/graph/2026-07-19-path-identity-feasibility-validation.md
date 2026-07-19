# 路径身份与歧义 wikilink · 可行性验证记录

- 日期：2026-07-19
- 分支：`feat/graph-id-collision-governance`
- 对应设计：[图谱身份、重复 ID 与歧义 wikilink 治理](../superpowers/specs/2026-07-19-graph-id-collision-governance-design.md)
- 结论：**方案层验证通过，可以定稿设计；生产功能尚未实现，不能跳过实施与验收**

## 1. 验证要回答的问题

本次不是验证“功能已经完成”，而是验证第四方案的关键前提是否成立：

1. 相对路径能否作为图谱节点 ID，且不破坏共享引擎、Sigma、工作台和离线 HTML。
2. 裸链接唯一时解析、重名时拒绝猜测，路径链接精确解析的规则能否落地。
3. 路径 ID 切换时，固定位置和刷新动画能否避免把身份迁移误报成知识结构变化。
4. 检查流程能否保持只读，且一次建索引后按页面与链接总量线性处理。
5. 大小写与 Unicode 差异在不同文件系统上如何保持可预测。

## 2. 代表性输入

一次性 fixture 共 8 个页面：

| 页面 | 用途 |
|---|---|
| `wiki/entities/foo.md` | 第一个同名页面 |
| `wiki/topics/foo.md` | 第二个同名页面，也是明确路径链接目标 |
| `wiki/sources/foo.md` | 第三个同名页面，证明不是“两两冲突”模型 |
| `wiki/entities/unique.md` | 裸名唯一目标 |
| `wiki/entities/foo-2.md` | 验证建议名需要继续避让 |
| `wiki/notes/links.md` | 放置全部链接样本 |
| `wiki/中文/页面.md` | 中文路径 |
| `wiki/with space/Page Name.md` | 空格与大小写路径 |

`links.md` 包含：

````md
[[unique]]
[[foo]]
[[wiki/topics/foo.md]]
[[wiki/topics/foo|别名]]
[[wiki/topics/foo#标题]]
[[wiki/topics/foo#^block|别名]]
`[[foo]]`
```md
[[foo]]
```
````

最后两处是代码示例，不应产生关系。fixture 的 Markdown 内容在检查前后逐项比较，确认没有写入。

## 3. 执行方式与实际结果

### 3.1 解析、性能、引擎、Sigma 与迁移原型

执行：

```bash
node --import tsx .tmp-graph-path-validation.mts
```

该文件是本次验证的一次性程序，验证后删除，不属于生产实现。它使用当前分支的共享图谱引擎和真实 Graphology 依赖；解析部分只实现设计所需的最小规则，用来证明数据结构与算法可行。

实际输出：

```json
{
  "fixture": { "pages": 8, "realLinks": 6, "ambiguousCandidates": 3 },
  "parsing": {
    "uniqueResolved": 1,
    "ambiguousNotLinked": 1,
    "pathVariantsResolved": 4,
    "codeExamplesIgnored": 2,
    "suggestedBasename": "foo-3",
    "markdownWrites": 0
  },
  "performance": { "nodes": 5000, "links": 20000, "durationMs": 11.9 },
  "engine": { "nodes": 4, "edges": 2, "sigmaNodes": 4, "sigmaEdges": 2 },
  "migration": {
    "beforeAlignment": { "added": 4, "removed": 4 },
    "afterSourcePathAlignment": { "added": 0, "removed": 0 }
  },
  "portability": {
    "caseFoldCollisionDetected": true,
    "unicodeCanonicalCollisionDetected": true
  }
}
```

性能数字只是用来排除“必须为每个冲突反复扫描全库”的方案缺陷，不是生产性能基线。正式实现仍需用真实文件读取和完整 Markdown 解析重新测量。

一次性程序用 NFC 与 JavaScript 的 locale-independent 小写转换覆盖代表性的 ASCII 大小写碰撞，并验证 NFC / NFD 等价；定稿 spec 进一步要求生产实现采用 Unicode Default Case Folding。特殊字符映射和三平台一致性属于实施后的正式测试范围，未被本原型替代。

### 3.2 当前分支回归检查

执行：

```bash
npm run test -w @llm-wiki/graph-engine
node --import tsx --test workbench/server/src/graph.test.ts workbench/server/src/graph-routes.test.ts
node --test-concurrency=1 --import tsx --import ./workbench/web/test/setup-dom.ts --test workbench/web/test/graph-panel-paper.test.tsx
```

结果：

- 共享图谱引擎：797 项通过，0 失败。
- 工作台图谱读取与布局：15 项通过，0 失败。
- `GraphPanel`：14 项通过，0 失败。

这些现有测试证明当前宿主契约没有把节点 ID 限定为 basename；它们不代表新的解析器、警告界面或迁移逻辑已经实现。

### 3.3 工作台与页面读取

向当前工作台图谱读取链路注入 4 个路径 ID 节点、2 条边后：

- 图谱数据可以正常读取。
- 节点选择保留完整路径 ID。
- 打开页面时使用 `source_path`，能定位到正确的同名页面。
- 固定位置继续使用 `source_path` key，`wiki/topics/foo.md` 的位置可以正常应用。

当前工作台还没有 `GraphWarningsBanner` 和新的 wikilink 解析器；这两项保留为实施后的验收项。

### 3.4 离线 HTML 实际浏览器验证

使用当前 `build-graph-html.sh` 和共享引擎 IIFE，内嵌手工构造的路径 ID 图谱数据，再在真实浏览器中打开生成的离线 HTML。实际观察：

- 页面显示 4 个节点、2 条关系，数量与输入一致。
- 搜索、单选、摘要、回全图和固定位置可用。
- 路径 ID 没有被截断、拆分或当成 URL。
- 内嵌数据只含 `wiki/...` 相对路径，没有用户主目录等本机完整路径。
- 视觉结果正常，没有节点重叠成一个 ID 或空白画布。

本次保留了临时截图供目视复核，但没有把临时产物提交到仓库。警告展示尚未实现，因此本次只验证离线宿主能完整消费路径 ID；警告界面必须在实施后另行验收。

### 3.5 大小写与 Unicode 的真实文件系统验证

在当前默认 macOS 文件系统上实际创建同目录文件：

```json
{
  "sameDirectoryCase": ["foo.md"],
  "sameDirectoryCaseContent": "upper",
  "sameDirectoryUnicode": ["café.md"],
  "crossDirectory": ["a/foo.md", "b/Foo.md"]
}
```

结论：同目录的 `foo.md` / `Foo.md` 以及 NFC / NFD 两种 `café.md` 不能可靠共存，后写会覆盖前写；跨目录的大小写差异可以共存。因此实现不能把当前操作系统的路径比较行为当作产品规则，必须另建可移植比较 key。

## 4. 逐项结论

| 验证项 | 结果 | 证据与限制 |
|---|---|---|
| 三个同名页面独立存在 | 通过 | 以三个不同路径 ID 进入原型与引擎 |
| 裸唯一链接 | 通过 | `[[unique]]` 唯一解析 |
| 裸歧义链接 | 通过 | `[[foo]]` 不建边，返回 3 个候选 |
| 路径、别名和锚点 | 通过 | 4 种写法都解析到 `wiki/topics/foo.md` |
| 代码示例排除 | 通过 | 围栏与行内代码共 2 处均被忽略 |
| 建议名避让 | 通过 | 已有 `foo-2.md` 时建议 `foo-3` |
| 共享引擎 | 通过 | 建模、摘要、搜索、选择、渲染数据与固定位置可用 |
| Sigma 主路线 | 通过 | Graphology 实际得到 4 节点、2 条边 |
| 工作台读取 | 通过 | 路径 ID 与 `source_path` 能定位正确页面 |
| 离线 HTML | 通过 | 真实浏览器打开并完成核心交互 |
| 首次身份迁移 | 有条件通过 | 现状误报 4 新增 + 4 删除；按 `source_path` 对齐后为 0，生产逻辑待实现 |
| 无界面只读检查 | 通过 | 检查前后 Markdown 完全一致，写入数为 0 |
| 一次索引性能 | 通过 | 5000 页面、20000 链接原型 11.9ms；不是生产基线 |
| 大小写 / Unicode | 有条件通过 | 规则可检测冲突；需正式跨平台自动化测试 |

## 5. 验证后必须写回设计的修正

1. 首次 basename ID → 路径 ID 迁移必须按 `source_path` 对齐同一页面；否则会播放全库删除再新增的误导动画。
2. 节点 ID 保留实际相对路径，不做静默小写或 Unicode 改写；另以 NFC + Unicode case-fold 生成只用于解析和冲突检测的可移植 key。
3. 可移植 key 碰撞时不能合并页面。严格检查失败，交互宿主列出全部候选；路径精确匹配仍以实际相对路径为准。
4. 验证门必须拆成“方案可行性已通过”和“生产实现后的验收”，不能把原型成功写成功能已经存在。
5. 警告展示、新解析器、迁移对齐和改名事务仍是待实现能力。

## 6. 最终结论

第四方案不需要再做方向级验证，可以据此定稿 spec。验证已经覆盖最容易推翻方案的四条主路径：解析正确性、共享引擎与两个宿主兼容、首次迁移、文件系统可移植性。

下一步仍不能直接进入编码。先由用户审阅定稿 spec；审阅通过后再写实施计划，并把本记录中的一次性 fixture 转成正式自动化测试和跨平台用例。
