# OMP 风格动态工具状态执行计划

日期：2026-06-15

## 目标

实现 `docs/spark/2026-06-15-omp-tool-status-events-design.md`：升级项目内部使用的 `pi-agent` 依赖，对齐新版 `omp` 更细的工具事件模型，并在当前 assistant 回复内部实现彩色动态工具条和丰富折叠历史摘要。

这不是 MVP。最终效果必须接近 `omp`：当前动作活跃、清楚、有节奏；历史动作不铺满屏幕，而是可折叠、可检查。

## 源文档

- `docs/spark/2026-06-15-omp-tool-status-events-design.md`
- `AGENTS.md`
- `workbench/AGENTS.md`
- `workbench/PRODUCT.md`

## 任务规模

L 级 phased plan。理由：该工作跨项目依赖迁移、后端事件协议、前端状态模型、视觉组件、历史消息兼容、自动测试和浏览器验收，且自然分阶段验证。

## 规格评审

结论：可以执行。

- 没有阻塞性产品决策缺口：用户已经确认升级对象是项目内部依赖，目标是对齐新版 `omp` 的动态当前工具条和折叠历史摘要。
- 主要漂移风险：实现时退回只包装旧 start/end 事件的轻量方案；本计划通过阶段 1 的依赖迁移验收和阶段 2 的稳定事件协议避免这个漂移。
- 主要技术风险：新版 `pi-agent` API 或事件字段与当前项目不兼容；本计划把依赖/API 勘查和后端适配层放在最前面，并要求迁移验收不过不得进入 UI 阶段。

## 执行规则

- 执行分支：`codex/feat-omp-tool-status-events`。
- 不在 `main` 上执行本计划。
- 执行开始前确认当前分支是专用分支，工作区除 `.superpowers/` 临时草图外没有无法分离的用户改动。
- 每完成一个已验证工作单元就提交一次，并把提交哈希记录到 `docs/plans/2026-06-15-omp-tool-status-events-progress.json`。
- 验证失败时不提交。
- 不自动 push、merge、amend。
- 阶段验收通过后直接进入下一阶段，不要求用户逐阶段确认。
- 执行者只能更新 progress 文件里的状态、证据、提交哈希、决策记录和 turn log，不能改写任务定义和验收标准。

## /goal 协议

每次继续工作时：

1. 读取 progress 文件，确认当前 phase/task。
2. 运行 `git log --oneline -15` 和本计划的基线 smoke check。
3. 只处理当前工作单元。
4. 验证通过后更新 progress、提交该工作单元、记录提交哈希。
5. 阶段验收全部通过后，记录阶段完成并进入下一阶段。

## Progress 文件

`docs/plans/2026-06-15-omp-tool-status-events-progress.json`

## 基线 Smoke Check

每个工作单元开始前运行：

```bash
npm run typecheck
```

如果依赖迁移中途导致全量 typecheck 暂时无法运行，当前工作单元必须先记录失败原因，并改跑该阶段指定的更小检查。恢复全量 `npm run typecheck` 是阶段验收条件，不能跳过。

## 实现面地图

### 后端

- `workbench/server/package.json`
- `package-lock.json`
- `workbench/server/src/agent.ts`
- `workbench/server/src/index.ts`
- `workbench/server/src/conversations.ts`
- 新增建议：`workbench/server/src/tool-status-events.ts`
- 新增建议：`workbench/server/src/tool-status-events.test.ts`
- 可能涉及 extension 类型导入：
  - `workbench/server/src/extensions/knowledge-base.ts`
  - `workbench/server/src/extensions/artifacts.ts`
  - `workbench/server/src/extensions/new-wiki.ts`
  - `workbench/server/src/extensions/synthesis.ts`
  - `workbench/server/src/digest/subagent.ts`

### 前端

- `workbench/web/src/lib/api.ts`
- `workbench/web/src/components/ChatPanel.tsx`
- `workbench/web/src/index.css`
- 新增建议：`workbench/web/src/lib/tool-status-model.ts`
- 新增建议：`workbench/web/src/lib/tool-status-format.ts`
- 新增建议：`workbench/web/src/components/ToolStatusRunway.tsx`
- 新增建议：`workbench/web/src/components/ToolHistorySummary.tsx`
- 新增测试：
  - `workbench/web/test/tool-status-model.test.ts`
  - `workbench/web/test/tool-status-format.test.ts`

### 文档

- `README.md`
- `CHANGELOG.md`
- 必要时更新 `workbench/PRODUCT.md` 的阶段记录或 ADR 摘要。

## 数据流

```text
pi-agent raw events
  -> server adapter: tool-status-events.ts
  -> /api/prompt SSE stable events
  -> web api.ts typed events
  -> tool-status-model.ts reducer
  -> ChatPanel assistant message state
  -> ToolStatusRunway + ToolHistorySummary
```

前端不得直接绑定底层 `pi-agent` 原始事件字段。后端负责把版本差异整理成工作台自己的稳定事件。

## 阶段 1：依赖迁移和事件能力验证

目标：把项目内部 `pi-agent` 依赖迁移到能对齐新版 `omp` 事件模型的包版本，并证明现有主链路没有被破坏。

实现面：

- `workbench/server/package.json`
- `package-lock.json`
- `workbench/server/src/agent.ts`
- `workbench/server/src/conversations.ts`
- `workbench/server/src/extensions/*`
- `workbench/server/src/digest/subagent.ts`

任务：

### 1.1 依赖和 API 勘查

确认当前项目使用的 `@earendil-works/*` 包、全局 `omp` 使用的 `@oh-my-pi/*` 包、npm 上可用目标版本，以及新版 SDK 的导出路径和事件类型。

验收：

- 记录目标包名和版本选择依据到 progress 的 `decision_log`。
- 不修改功能代码。
- `npm run typecheck` 在原状态下 exits 0；如果原状态已经失败，progress 必须记录失败输出，并且 1.2 的验收必须先恢复迁移相关 typecheck。

### 1.2 迁移项目依赖和导入路径

把项目内部依赖迁移到目标 `pi-agent` 包族，更新导入路径和类型使用，直到后端可以编译。

验收：

- `npm install` exits 0。
- `npm run typecheck --workspace=@llm-wiki-agent/server` exits 0。
- 不修改用户全局 `omp` 或全局 `pi-agent`。
- 不直接修改 `node_modules`。

### 1.3 后端运行烟测

启动后端和前端，证明基础会话、知识库上下文、Skill 注册、会话历史读取仍然可用。

验收：

- `npm run dev` 能启动前端和后端，前端端口为 `5180`，后端端口为 `8787`。
- 浏览器打开 `http://localhost:5180/` 能加载。
- 选中一个知识库后能看到当前模型和对话区域。
- 发送一个普通问题能收到 assistant 回复。
- 发送一个会触发当前知识库检索的问题，后端没有报错。
- `npm run typecheck` exits 0。

阶段 1 完成规则：1.1、1.2、1.3 全部验收通过并提交后，自动进入阶段 2。

## 阶段 2：后端稳定工具事件协议

目标：后端提供工作台自己的稳定工具事件，不让前端依赖底层事件差异。

实现面：

- `workbench/server/src/index.ts`
- `workbench/server/src/tool-status-events.ts`
- `workbench/server/src/tool-status-events.test.ts`
- `workbench/server/src/conversations.ts`

任务：

### 2.1 建立 Tool Status 事件适配器

新增后端适配器，把新版 `pi-agent` 原始事件转换为稳定事件：`assistant_text_delta`、`tool_status_start`、`tool_status_update`、`tool_status_end`、`tool_status_summary`、`assistant_done`、`assistant_error`。

验收：

- 适配器能处理工具开始、参数更新、工具结束、工具失败、缺参数事件。
- 适配器能从 read/write/bash/search/skill 常见参数生成用户可读动作和目标。
- `node --import tsx --test workbench/server/src/tool-status-events.test.ts` exits 0。

### 2.2 接入 `/api/prompt` SSE

把 `/api/prompt` 从旧的 `tool_start` / `tool_end` 输出改为稳定工具事件。当前知识库检索也要作为同一套工具状态事件进入前端，而不是单独塞进旧工具列表。

验收：

- `text_delta` 或等价正文增量仍能正常流式输出。
- 知识库检索开始、完成、为空、失败都有工具状态事件。
- artifact_created 事件不被破坏。
- `npm run typecheck --workspace=@llm-wiki-agent/server` exits 0。

### 2.3 历史消息摘要兼容

更新会话历史转换，让历史 assistant 消息能显示完成后的工具摘要，而不是恢复动态跑马灯或旧的一长串工具。

验收：

- 旧会话中已有工具调用仍能显示为摘要。
- 没有工具调用的历史消息不显示空摘要。
- `node --import tsx --test workbench/server/src/tool-status-events.test.ts workbench/server/src/retrieval.test.ts` exits 0。

阶段 2 完成规则：所有任务验收通过，`npm run typecheck` exits 0，并提交后自动进入阶段 3。

## 阶段 3：前端工具状态模型

目标：前端建立独立的工具状态模型，当前工具条和历史摘要由模型驱动，不再把实时工具直接塞进消息数组。

实现面：

- `workbench/web/src/lib/api.ts`
- `workbench/web/src/lib/tool-status-model.ts`
- `workbench/web/src/lib/tool-status-format.ts`
- `workbench/web/src/components/ChatPanel.tsx`
- `workbench/web/test/tool-status-model.test.ts`
- `workbench/web/test/tool-status-format.test.ts`

任务：

### 3.1 定义前端 Tool Status 类型和 reducer

新增前端类型和 reducer，把 start/update/end/summary 事件归并成当前运行项、完成项、分组摘要、失败项。

验收：

- reducer 单测覆盖连续工具切换、缺参数、失败、取消、并行工具、摘要截断。
- `npm run test --workspace=@llm-wiki-agent/web -- tool-status-model.test.ts` exits 0，或若 npm test 不支持文件过滤，则 `npm run test --workspace=@llm-wiki-agent/web` exits 0。

### 3.2 格式化用户可读工具动作

新增格式化逻辑，保证 read/write/bash/search/skill 的动作标签和目标短句稳定、可截断、可分组。

验收：

- 格式化单测覆盖长路径、长命令、空参数、未知工具。
- 输出不包含私密绝对路径的完整用户目录；长路径默认保留相对路径或文件名尾部。
- `npm run test --workspace=@llm-wiki-agent/web` exits 0。

### 3.3 重接 ChatPanel 流式事件

ChatPanel 使用新工具状态模型驱动当前 assistant 回复。旧的 `message.tools` 实时追加逻辑停止用于运行中工具展示。

验收：

- 文本流仍显示在当前 assistant 回复中。
- 同一时间当前回复只显示一个当前工具状态。
- 工具完成后进入摘要，不再生成一长串 `.msg-tool` 行。
- `npm run typecheck --workspace=@llm-wiki-agent/web` exits 0。

阶段 3 完成规则：所有任务验收通过，`npm run typecheck` exits 0，并提交后自动进入阶段 4。

## 阶段 4：OMP 风格视觉组件

目标：实现当前 assistant 回复内部的彩色动态工具条，以及丰富但折叠的历史摘要。

实现面：

- `workbench/web/src/components/ToolStatusRunway.tsx`
- `workbench/web/src/components/ToolHistorySummary.tsx`
- `workbench/web/src/components/ChatPanel.tsx`
- `workbench/web/src/index.css`

任务：

### 4.1 实现 ToolStatusRunway

新增彩色动态工具条，显示动作动词、目标、状态；支持运行中、完成、失败、取消；支持深色和浅色主题。

验收：

- 运行中状态有彩色动态效果。
- 失败和取消状态视觉上可区分。
- 目标过长时不会撑破布局。
- `npm run typecheck --workspace=@llm-wiki-agent/web` exits 0。

### 4.2 实现 ToolHistorySummary

新增折叠摘要组件，默认展示分组、数量和少量关键目标；展开后展示完整清单。

验收：

- 默认折叠态空间占用小。
- Read/Write/Bash/Search/Skill 能按组展示。
- 超过展示上限时显示剩余数量。
- 展开/收起不影响正文 Markdown 排版。
- `npm run test --workspace=@llm-wiki-agent/web` exits 0。

### 4.3 替换旧工具列表视觉

移除或停用当前 `.msg-tools` 实时流水账展示，确保新组件挂在当前 assistant 回复内部、正文之前。

验收：

- 复杂任务运行时主聊天区不会出现连续几十行工具名。
- 历史消息显示折叠摘要，不显示动态跑马灯。
- 窄屏下没有横向滚动。
- `npm run typecheck` exits 0。

阶段 4 完成规则：所有任务验收通过，`npm run typecheck` exits 0，并提交后自动进入阶段 5。

## 阶段 5：端到端验收、文档和收尾

目标：真实跑通长任务，确认体验接近 `omp`，并更新用户可见文档。

实现面：

- `README.md`
- `CHANGELOG.md`
- 必要时 `workbench/PRODUCT.md`
- 浏览器验证记录写入 progress 文件

任务：

### 5.1 真实任务浏览器验收

启动应用并运行一个会触发多次 read/write/bash 或 Skill 工具调用的代表性任务。

验收：

- Browser 打开 `http://localhost:5180/`。
- 在 1440px、768px、390px 视口下检查聊天区。
- 运行任务期间当前 assistant 回复中始终只有一个当前工具条。
- 工具切换时工具条内容更新。
- 工具结束后出现折叠摘要。
- 展开摘要后能看到分组和明细。
- 没有明显文字溢出、遮挡输入框、横向滚动。
- 验收截图或文字证据记录到 progress。

### 5.2 回归验证

跑自动检查和核心后端/前端测试。

验收：

- `npm run typecheck` exits 0。
- `npm run test --workspace=@llm-wiki-agent/web` exits 0。
- `node --import tsx --test workbench/server/src/*.test.ts` exits 0，或如果某些既有 server 测试因环境前置条件失败，记录失败测试名、失败原因，并至少证明本次新增/修改的 server 测试 exits 0。

### 5.3 文档更新

按仓库规则更新用户可见文档。

验收：

- `CHANGELOG.md` 顶部增加本次功能条目。
- `README.md` 的功能列表提到 `omp` 风格动态工具状态和折叠摘要。
- 如果实现中改变了产品阶段或 ADR 决策，`workbench/PRODUCT.md` 有对应说明；如果没有改变，progress 记录“不需要更新 PRODUCT.md”的理由。
- `git diff --check` exits 0。

阶段 5 完成规则：所有验收通过，progress 记录最终状态和残余风险，提交最后一个工作单元后停止并汇报。

## 测试计划

自动测试：

- `npm run typecheck`
- `npm run typecheck --workspace=@llm-wiki-agent/server`
- `npm run typecheck --workspace=@llm-wiki-agent/web`
- `npm run test --workspace=@llm-wiki-agent/web`
- `node --import tsx --test workbench/server/src/tool-status-events.test.ts`
- `node --import tsx --test workbench/server/src/*.test.ts`

浏览器测试：

- `http://localhost:5180/`
- 视口：1440px desktop、768px tablet、390px mobile
- 场景：普通问答、当前知识库检索、多工具长任务、历史会话恢复、深色/浅色主题切换

## 不在范围内

- 不修改用户本机全局 `omp`。
- 不直接修改 `node_modules`。
- 不把工具完整输出铺进主聊天区。
- 不重做整个聊天系统。
- 不新增桌面打包能力。
- 不新增无关知识库功能。

## 失败模式和恢复

- 依赖升级后 SDK API 不兼容：阶段 1 必须先修 imports/typecheck，不能进入 UI 阶段；必要时锁定可用新版版本并记录理由。
- 新版事件缺少某些工具参数：后端适配器必须降级显示工具名和通用动作，不能让前端空白。
- 多工具并行导致当前工具跳动过快：前端模型显示最近活跃项，摘要保留全部，必要时显示“另有 N 项运行中”。
- 历史会话缺少新摘要字段：历史转换必须从已有 assistant tool calls 生成摘要，不能破坏旧会话展示。
- 动画影响可读性或性能：CSS 动效必须可读，长文本截断；如果系统减少动态效果，仍要保留清楚状态。

## 决策记录

- 决策：采用项目内依赖升级，而不是只做前端包装。
  原因：用户明确要求对齐新版 `omp` 事件模型，不接受 MVP 版。
  拒绝方案：只用旧 start/end 事件做粗粒度工具条。
  来源：用户确认“升级这个项目里依赖的那份 pi-agent，然后对齐新版 omp 的事件模型”。

- 决策：前端不直接绑定 `pi-agent` 原始事件。
  原因：底层依赖升级可能带来事件字段变化，工作台需要稳定协议。
  拒绝方案：ChatPanel 直接识别所有底层事件字段。
  来源：spec 的“事件设计”和现有 SSE 结构。

- 决策：工具条放在当前 assistant 回复内部、正文之前。
  原因：用户在视觉草图中选择 A。
  拒绝方案：悬浮输入框上方或顶部状态栏。
  来源：用户选择。

## /goal Starter

```text
/goal Implement docs/plans/2026-06-15-omp-tool-status-events-phased-plan.md by following its execution ledger.

Each turn:
1. Read docs/plans/2026-06-15-omp-tool-status-events-progress.json, then the current task in the plan.
2. Run `git log --oneline -15` and `npm run typecheck`; repair a broken state before starting new work.
3. Work only on the current work unit.
4. After verification passes: update the progress file (status, evidence, and log fields only), commit that unit, record the commit hash. Never commit on failed verification. Never push, merge, or amend.
5. When a phase's acceptance checks all pass, record it and continue to the next phase without asking.

Done when every task is complete, every acceptance check is proven, and the progress file records final status and residual risk.
```
