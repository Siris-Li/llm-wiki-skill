# Unified Community Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one right-side drawer for normal communities and “未分组”, while restoring Sigma Shift multi-select and the single-node “+邻居” entry.

**Architecture:** The graph engine will produce consistent selection and summary data, including the `_none` virtual community. The workbench frontend will own the unified drawer view model, layout, agent actions, free-text prompt flow, and visual behavior. Existing community navigation remains a graph summary command, while agent actions reuse the current selection prompt pipeline.

**Tech Stack:** TypeScript, React 19, Node built-in test runner, jsdom React server rendering tests, Sigma/Graphology graph renderer, existing llm-wiki workbench CSS.

---

## Completion Standard

- Clicking a normal community opens the unified community drawer with top “进入社区”, overview facts, fixed actions, compact core nodes, and dialogue controls.
- Clicking “未分组” opens the same drawer structure, does not show “进入社区”, and recommends “探索潜在关系”.
- Normal communities always show “探索潜在关系” as a secondary action.
- Search hits, fixed nodes, and bridge relations no longer appear as large empty first-screen sections.
- Single-node summaries show a clear “+邻居” command.
- Sigma global Shift+click adds or removes nodes from a multi-selection.
- Unit tests, typecheck, lint, and browser validation cover the behavior.
- `CHANGELOG.md` and `README.md` describe the user-facing change before push.

## Reference Documents

- Spec: `docs/superpowers/specs/2026-06-28-unified-community-drawer-design.md`
- Visual reference: `docs/superpowers/specs/unified-community-drawer-v3-reference.png`

## File Structure

- Modify `packages/graph-engine/src/types.ts`: add `_none` constants, community summary overview fields, `select-neighbors` command, and action metadata types used by the drawer.
- Modify `packages/graph-engine/src/summary/index.ts`: make `_none` a real virtual community in summaries and add community overview facts.
- Modify `packages/graph-engine/src/select/index.ts`: share `_none` mapping and add Shift toggle helper for Sigma.
- Modify `packages/graph-engine/src/render/sigma-hit-projector.ts`: extract Shift/additive intent from Sigma events.
- Modify `packages/graph-engine/src/render/sigma-global-types.ts`: pass additive click context from the Sigma renderer.
- Modify `packages/graph-engine/src/render/sigma-global-renderer.ts`: include additive context on node hits.
- Modify `packages/graph-engine/src/facade.ts`: convert additive Sigma node hits into `nodes` selections or selection clear.
- Create `workbench/web/src/lib/graph-community-drawer.ts`: derive the unified community drawer view model and fixed action list.
- Modify `workbench/web/src/lib/drawer-state.ts`: store community free text in drawer state.
- Modify `workbench/web/src/lib/graph-summary-actions.ts`: preserve community drawer text and keep `_none` routed to community summary.
- Modify `workbench/web/src/components/GraphSummaryDrawer.tsx`: replace the heavy community summary with the unified drawer layout and add the node “+邻居” command display.
- Modify `workbench/web/src/components/RightDrawer.tsx`: pass community dialogue handlers and render the new community props.
- Modify `workbench/web/src/App.tsx`: wire community free text, community asks, `select-neighbors`, and Shift selection state refresh.
- Modify `workbench/web/src/index.css`: add unified community drawer styles and remove first-screen emphasis from obsolete community blocks.
- Modify tests under `packages/graph-engine/test/` and `workbench/web/test/`: lock the new behavior.
- Modify `CHANGELOG.md` and `README.md`: document the shipped behavior.

---

### Task 1: Engine Summary Contract For `_none`

**Files:**
- Modify: `packages/graph-engine/src/types.ts`
- Modify: `packages/graph-engine/src/summary/index.ts`
- Test: `packages/graph-engine/test/summary-contract.test.ts`

- [ ] **Step 1: Write the failing `_none` community summary test**

Add this test to `packages/graph-engine/test/summary-contract.test.ts` after the existing community summary test:

```ts
it("summarizes the ungrouped virtual community as a community payload", () => {
  const data = graphFixtureWithUngroupedNodes();
  const summary = summarizeGraphCommunity(data, "_none", {
    selection: { kind: "community", id: "_none" },
    searchResultIds: ["loose-a"]
  });

  assert.equal(summary.kind, "community-summary");
  assert.equal(summary.communityId, "_none");
  assert.equal(summary.label, "未分组");
  assert.equal(summary.nodeCount, 2);
  assert.equal(summary.pageCount, 2);
  assert.equal(summary.linkCount, 0);
  assert.equal(summary.isolatedCount, 1);
  assert.equal(summary.structureState, "ungrouped");
  assert.equal(summary.canEnterCommunity, false);
  assert.equal(summary.description, "这些页面暂未形成明确社区。你可以让 agent 探索它们之间是否存在潜在关系。");
  assert.deepEqual(summary.searchResultIds, ["loose-a"]);
  assert.deepEqual(summary.selection.selectedNodeIds, ["loose-a", "loose-b"]);
  assert.deepEqual(summary.selection.selectedCommunityIds, ["_none"]);
  assert.deepEqual(summary.commands.map((command) => command.kind), []);
  assert.deepEqual(summary.coreNodes.map((node) => node.nodeId), ["loose-a", "loose-b"]);
  assert.deepEqual(summary.coreNodes.map((node) => node.label), ["Loose A", "Loose B"]);
});

function graphFixtureWithUngroupedNodes(): GraphData {
  const base = graphFixture();
  return {
    ...base,
    meta: {
      ...base.meta,
      total_nodes: base.meta.total_nodes + 2
    },
    nodes: [
      ...base.nodes,
      { id: "loose-a", label: "Loose A", type: "topic", community: null, source_path: "wiki/loose/a.md", score: 2 },
      { id: "loose-b", label: "Loose B", type: "entity", source_path: "wiki/loose/b.md", weight: 1 }
    ]
  };
}
```

- [ ] **Step 2: Run the failing summary test**

Run:

```bash
node --import tsx --test packages/graph-engine/test/summary-contract.test.ts
```

Expected: fail because `GraphCommunitySummaryPayload` does not have `pageCount`, `linkCount`, `isolatedCount`, `structureState`, `description`, `canEnterCommunity`, or `coreNodes`, and `_none` currently returns an unavailable summary.

- [ ] **Step 3: Add community summary fields and constants**

In `packages/graph-engine/src/types.ts`, add constants near the graph type aliases:

```ts
export const UNGROUPED_COMMUNITY_ID = "_none";
export const UNGROUPED_COMMUNITY_LABEL = "未分组";

export type GraphCommunityStructureState = "clear" | "loose" | "ungrouped";

export interface GraphCommunityCoreNode {
  nodeId: NodeId;
  label: string;
  type: GraphNodeType;
  role: "核心" | "主题" | "相关";
}
```

Update `GraphSummaryCommand`:

```ts
export type GraphSummaryCommand =
  | {
      kind: "enter-community";
      communityId: CommunityId;
      label: string;
    }
  | {
      kind: "select-neighbors";
      nodeId: NodeId;
      label: string;
    }
  | {
      kind: "open-detail-read";
      nodeId: NodeId;
      path: WikiPath;
      label: string;
    }
  | {
      kind: "show-this-object";
      object: GraphSummaryObjectRef;
      label: string;
    }
  | {
      kind: "clear-temporary-object-display";
      label: string;
    }
  | {
      kind: "set-fixed-position";
      mode: "fix" | "unfix";
      nodeId: NodeId;
      wikiPath: WikiPath;
      label: string;
    };
```

Update `GraphCommunitySummaryPayload`:

```ts
export interface GraphCommunitySummaryPayload {
  kind: "community-summary";
  object: { kind: "community"; communityId: CommunityId };
  communityId: CommunityId;
  label: string;
  nodeCount: number;
  pageCount: number;
  linkCount: number;
  isolatedCount: number;
  structureState: GraphCommunityStructureState;
  description: string;
  canEnterCommunity: boolean;
  coreNodeIds: NodeId[];
  coreNodes: GraphCommunityCoreNode[];
  searchResultIds: NodeId[];
  pinHints: GraphPinHint[];
  selection: GraphSummarySelectionState;
  strongestRelations: GraphRelationSummary[];
  bridgeRelations: GraphRelationSummary[];
  aggregationMarkers: GraphAggregationMarker[];
  commands: GraphSummaryCommand[];
}
```

- [ ] **Step 4: Implement `_none` community summary support**

In `packages/graph-engine/src/summary/index.ts`, import the new constants and type:

```ts
  GraphCommunityCoreNode,
  UNGROUPED_COMMUNITY_ID,
  UNGROUPED_COMMUNITY_LABEL,
```

Replace the return body of `summarizeGraphCommunity` with this shape:

```ts
  const coreIds = coreNodeIds(data, nodes);
  const internalLinkCount = internalLinkCountForNodes(data, nodeIds);
  const isolatedCount = isolatedNodeCount(index, nodes);
  const structureState = communityStructureState(communityId, nodes.length, internalLinkCount, isolatedCount);
  const canEnterCommunity = communityId !== UNGROUPED_COMMUNITY_ID && Boolean(community);
  return {
    kind: "community-summary",
    object: { kind: "community", communityId },
    communityId,
    label: communityLabel(community?.label, communityId),
    nodeCount: Number(community?.node_count ?? nodes.length),
    pageCount: nodes.length,
    linkCount: internalLinkCount,
    isolatedCount,
    structureState,
    description: communityDescription(structureState),
    canEnterCommunity,
    coreNodeIds: coreIds,
    coreNodes: coreNodeSummaries(data, coreIds),
    searchResultIds: searchHits,
    pinHints,
    selection: selectionStateForObject(data, { kind: "community", communityId }, options.selection),
    strongestRelations: topRelations(relations, DEFAULT_LIMIT),
    bridgeRelations: topRelations(relations.filter((relation) => relation.bridge), DEFAULT_LIMIT),
    aggregationMarkers: markersContainingCommunity(options.aggregationMarkers, communityId),
    commands: communitySummaryCommands(communityId, canEnterCommunity)
  };
```

Add these helper functions below `nodeSummaryCommands`:

```ts
function communitySummaryCommands(communityId: CommunityId, canEnterCommunity: boolean): GraphSummaryCommand[] {
  return canEnterCommunity
    ? [{ kind: "enter-community", communityId, label: "进入社区" }]
    : [];
}

function communityLabel(label: string | null | undefined, communityId: CommunityId): string {
  if (communityId === UNGROUPED_COMMUNITY_ID) return UNGROUPED_COMMUNITY_LABEL;
  return label || communityId;
}

function communityDescription(state: "clear" | "loose" | "ungrouped"): string {
  if (state === "ungrouped") return "这些页面暂未形成明确社区。你可以让 agent 探索它们之间是否存在潜在关系。";
  if (state === "loose") return "这组页面结构还比较松散。你可以先找知识缺口，也可以继续探索潜在关系。";
  return "这组页面围绕同一主题聚在一起。你可以先看结构，也可以直接让 agent 基于这一组页面继续工作。";
}

function communityStructureState(
  communityId: CommunityId,
  nodeCount: number,
  internalLinkCount: number,
  isolatedCount: number
): "clear" | "loose" | "ungrouped" {
  if (communityId === UNGROUPED_COMMUNITY_ID) return "ungrouped";
  if (nodeCount <= 1 || internalLinkCount === 0 || isolatedCount > Math.floor(nodeCount / 2)) return "loose";
  return "clear";
}

function coreNodeSummaries(data: GraphData, ids: NodeId[]): GraphCommunityCoreNode[] {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  return ids.flatMap((id, index) => {
    const node = nodeById.get(id);
    if (!node) return [];
    return [{
      nodeId: node.id,
      label: node.label || node.id,
      type: node.type,
      role: index === 0 ? "核心" : node.type === "topic" ? "主题" : "相关"
    }];
  });
}

function internalLinkCountForNodes(data: GraphData, nodeIds: Set<NodeId>): number {
  return data.edges.filter((edge) => {
    const from = endpointId(edge.from);
    const to = endpointId(edge.to);
    return Boolean(from && to && nodeIds.has(from) && nodeIds.has(to));
  }).length;
}

function isolatedNodeCount(index: SummaryIndex, nodes: GraphNode[]): number {
  return nodes.filter((node) => (index.edgesByNodeId.get(node.id)?.length ?? 0) === 0).length;
}
```

Replace `nodesForCommunity`:

```ts
function nodesForCommunity(data: GraphData, communityId: CommunityId): GraphNode[] {
  return data.nodes.filter((node) => communityIdForNode(node) === communityId);
}

function communityIdForNode(node: GraphNode): CommunityId {
  return String(node.community || UNGROUPED_COMMUNITY_ID);
}
```

Update `communityIds` to include `_none` when ungrouped nodes exist:

```ts
function communityIds(data: GraphData): CommunityId[] {
  const ids = new Set<CommunityId>();
  for (const community of data.learning?.communities ?? []) ids.add(community.id);
  for (const node of data.nodes) ids.add(communityIdForNode(node));
  return [...ids];
}
```

- [ ] **Step 5: Run the summary test**

Run:

```bash
node --import tsx --test packages/graph-engine/test/summary-contract.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit the engine summary contract**

Run:

```bash
git add packages/graph-engine/src/types.ts packages/graph-engine/src/summary/index.ts packages/graph-engine/test/summary-contract.test.ts
git commit -m "fix: summarize ungrouped graph community"
```

Expected: commit succeeds.

---

### Task 2: Community Drawer View Model

**Files:**
- Create: `workbench/web/src/lib/graph-community-drawer.ts`
- Test: `workbench/web/test/graph-community-drawer.test.ts`

- [ ] **Step 1: Write failing view-model tests**

Create `workbench/web/test/graph-community-drawer.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { graphCommunityDrawerViewModel, communityDrawerActionById } from "../src/lib/graph-community-drawer";
import type { GraphCommunitySummaryPayload } from "@llm-wiki/graph-engine";

describe("graph community drawer view model", () => {
  it("keeps normal community actions stable and enter-community available", () => {
    const view = graphCommunityDrawerViewModel(summaryFixture());

    assert.equal(view.kicker, "社区");
    assert.equal(view.title, "Knowledge Build");
    assert.equal(view.canEnterCommunity, true);
    assert.equal(view.recommendedActionId, "summarize_cluster");
    assert.deepEqual(view.facts, [
      { label: "页", value: 6 },
      { label: "链接", value: 5 },
      { label: "核心", value: 3 },
      { label: "孤立", value: 0 }
    ]);
    assert.deepEqual(view.actions.map((action) => action.label), [
      "总结这一簇",
      "找知识缺口",
      "生成主题页",
      "探索潜在关系"
    ]);
    assert.equal(view.actions.find((action) => action.id === "explore_potential_links")?.recommended, false);
    assert.equal(view.tags.includes("结构清晰"), true);
    assert.equal(view.tags.includes("无搜索命中"), false);
  });

  it("recommends potential relation exploration for ungrouped community", () => {
    const view = graphCommunityDrawerViewModel(summaryFixture({
      communityId: "_none",
      label: "未分组",
      structureState: "ungrouped",
      canEnterCommunity: false,
      linkCount: 0,
      isolatedCount: 2
    }));

    assert.equal(view.canEnterCommunity, false);
    assert.equal(view.recommendedActionId, "explore_potential_links");
    assert.equal(view.actions.find((action) => action.id === "explore_potential_links")?.recommended, true);
    assert.equal(view.tags.includes("暂未成组"), true);
  });

  it("finds fixed actions by id for prompt dispatch", () => {
    assert.equal(communityDrawerActionById("find_knowledge_gaps")?.label, "找知识缺口");
    assert.equal(communityDrawerActionById("missing"), null);
    assert.equal(communityDrawerActionById(null), null);
  });
});

function summaryFixture(overrides: Partial<GraphCommunitySummaryPayload> = {}): GraphCommunitySummaryPayload {
  return {
    kind: "community-summary",
    object: { kind: "community", communityId: "build" },
    communityId: "build",
    label: "Knowledge Build",
    nodeCount: 6,
    pageCount: 6,
    linkCount: 5,
    isolatedCount: 0,
    structureState: "clear",
    description: "这组页面围绕同一主题聚在一起。你可以先看结构，也可以直接让 agent 基于这一组页面继续工作。",
    canEnterCommunity: true,
    coreNodeIds: ["a", "b", "c"],
    coreNodes: [
      { nodeId: "a", label: "Alpha", type: "topic", role: "核心" },
      { nodeId: "b", label: "Beta", type: "entity", role: "相关" },
      { nodeId: "c", label: "Gamma", type: "source", role: "相关" }
    ],
    searchResultIds: [],
    pinHints: [],
    selection: {
      input: { kind: "community", id: "build" },
      selectionId: "community:a,b,c",
      selectedNodeIds: ["a", "b", "c"],
      selectedCommunityIds: ["build"],
      containsCurrentObject: true
    },
    strongestRelations: [],
    bridgeRelations: [],
    aggregationMarkers: [],
    commands: [{ kind: "enter-community", communityId: "build", label: "进入社区" }],
    ...overrides
  };
}
```

- [ ] **Step 2: Run the failing view-model test**

Run:

```bash
node --import tsx --test workbench/web/test/graph-community-drawer.test.ts
```

Expected: fail because `workbench/web/src/lib/graph-community-drawer.ts` does not exist.

- [ ] **Step 3: Create the community drawer view model**

Create `workbench/web/src/lib/graph-community-drawer.ts`:

```ts
import type {
  GraphCommunitySummaryPayload,
  SelectionAction,
  SelectionActionId,
  SelectionActionTone
} from "@llm-wiki/graph-engine";

export interface GraphCommunityDrawerFact {
  label: string;
  value: number;
}

export interface GraphCommunityDrawerAction extends SelectionAction {
  recommended: boolean;
}

export interface GraphCommunityDrawerViewModel {
  kicker: string;
  title: string;
  description: string;
  canEnterCommunity: boolean;
  recommendedActionId: SelectionActionId;
  facts: GraphCommunityDrawerFact[];
  tags: string[];
  actions: GraphCommunityDrawerAction[];
  coreNodes: GraphCommunitySummaryPayload["coreNodes"];
}

const FIXED_COMMUNITY_ACTIONS: Array<SelectionAction & { id: SelectionActionId; tone: SelectionActionTone }> = [
  { id: "summarize_cluster", label: "总结这一簇", tone: "digest" },
  { id: "find_knowledge_gaps", label: "找知识缺口", tone: "lint" },
  { id: "create_topic_page", label: "生成主题页", tone: "write" },
  { id: "explore_potential_links", label: "探索潜在关系", tone: "bridge" }
];

export function graphCommunityDrawerViewModel(payload: GraphCommunitySummaryPayload): GraphCommunityDrawerViewModel {
  const recommendedActionId = recommendedActionForCommunity(payload);
  return {
    kicker: "社区",
    title: payload.label,
    description: payload.description,
    canEnterCommunity: payload.canEnterCommunity,
    recommendedActionId,
    facts: [
      { label: "页", value: payload.pageCount },
      { label: "链接", value: payload.linkCount },
      { label: "核心", value: payload.coreNodeIds.length },
      { label: "孤立", value: payload.isolatedCount }
    ],
    tags: communityTags(payload),
    actions: FIXED_COMMUNITY_ACTIONS.map((action) => ({
      ...action,
      recommended: action.id === recommendedActionId
    })),
    coreNodes: payload.coreNodes.slice(0, 3)
  };
}

export function communityDrawerActionById(id: string | null): SelectionAction | null {
  if (!id) return null;
  return FIXED_COMMUNITY_ACTIONS.find((action) => action.id === id) ?? null;
}

function recommendedActionForCommunity(payload: GraphCommunitySummaryPayload): SelectionActionId {
  if (payload.structureState === "ungrouped") return "explore_potential_links";
  if (payload.structureState === "loose") return "find_knowledge_gaps";
  return "summarize_cluster";
}

function communityTags(payload: GraphCommunitySummaryPayload): string[] {
  const tags = [structureLabel(payload.structureState)];
  if (payload.pinHints.length > 0) tags.push(`${payload.pinHints.length} 固定`);
  if (payload.searchResultIds.length > 0) tags.push(`${payload.searchResultIds.length} 命中`);
  return tags;
}

function structureLabel(state: GraphCommunitySummaryPayload["structureState"]): string {
  if (state === "ungrouped") return "暂未成组";
  if (state === "loose") return "结构松散";
  return "结构清晰";
}
```

- [ ] **Step 4: Run the view-model test**

Run:

```bash
node --import tsx --test workbench/web/test/graph-community-drawer.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit the view model**

Run:

```bash
git add workbench/web/src/lib/graph-community-drawer.ts workbench/web/test/graph-community-drawer.test.ts
git commit -m "feat: add unified community drawer model"
```

Expected: commit succeeds.

---

### Task 3: Drawer State And Community Prompt Flow

**Files:**
- Modify: `workbench/web/src/lib/drawer-state.ts`
- Modify: `workbench/web/src/lib/graph-summary-actions.ts`
- Modify: `workbench/web/src/App.tsx`
- Test: `workbench/web/test/graph-summary-actions.test.ts`

- [ ] **Step 1: Write failing routing and preservation tests**

Add these tests to `workbench/web/test/graph-summary-actions.test.ts`:

```ts
it("turns an ungrouped community selection into a community summary drawer", () => {
  const drawer = drawerForGraphSelection(graphFixtureWithUngroupedNodes(), ungroupedSelection(), closedDrawer());

  assert.equal(drawer.mode, "graph-community-summary");
  assert.equal(drawer.mode === "graph-community-summary" ? drawer.payload.communityId : null, "_none");
  assert.equal(drawer.mode === "graph-community-summary" ? drawer.payload.canEnterCommunity : null, false);
});

it("preserves community free text while refreshing the same community drawer", () => {
  const current = drawerForGraphSelection(graphFixture(), communitySelection(), closedDrawer());
  assert.equal(current.mode, "graph-community-summary");
  const withText = current.mode === "graph-community-summary"
    ? graphCommunitySummaryDrawer(current.payload, "请重点看缺口")
    : current;

  const next = drawerForGraphSelection(graphFixture(), communitySelection(), withText);

  assert.equal(next.mode, "graph-community-summary");
  assert.equal(next.mode === "graph-community-summary" ? next.freeText : null, "请重点看缺口");
});

function ungroupedSelection(): Selection {
  return {
    id: "community:loose-a,loose-b",
    nodeIds: ["loose-a", "loose-b"],
    communityIds: ["_none"],
    facts: {
      pageCount: 2,
      internalLinkCount: 0,
      communityCount: 1,
      isolatedCount: 2
    },
    actions: []
  };
}

function graphFixtureWithUngroupedNodes(): GraphData {
  const base = graphFixture();
  return {
    ...base,
    nodes: [
      ...base.nodes,
      { id: "loose-a", label: "Loose A", type: "topic", community: null, source_path: "wiki/loose/a.md" },
      { id: "loose-b", label: "Loose B", type: "entity", source_path: "wiki/loose/b.md" }
    ]
  };
}
```

- [ ] **Step 2: Run the failing routing tests**

Run:

```bash
node --import tsx --test workbench/web/test/graph-summary-actions.test.ts
```

Expected: fail because `graph-community-summary` does not store `freeText`, and `_none` still falls back without Task 1 code.

- [ ] **Step 3: Store community free text in drawer state**

In `workbench/web/src/lib/drawer-state.ts`, update the community drawer state:

```ts
| {
    mode: "graph-community-summary";
    payload: GraphCommunitySummaryPayload;
    freeText: string;
  }
```

Replace the helper:

```ts
export function graphCommunitySummaryDrawer(payload: GraphCommunitySummaryPayload, freeText = ""): DrawerState {
  return { mode: "graph-community-summary", payload, freeText };
}
```

- [ ] **Step 4: Preserve free text in summary routing**

In `workbench/web/src/lib/graph-summary-actions.ts`, add this helper:

```ts
function communityFreeText(current: DrawerState, communityId: string): string {
  return current.mode === "graph-community-summary" && current.payload.communityId === communityId
    ? current.freeText
    : "";
}
```

Update both community drawer creation sites:

```ts
if (summary.kind === "community-summary") {
  return graphCommunitySummaryDrawer(summary, communityFreeText(current, selection.communityIds[0]));
}
```

```ts
if (summary.kind === "community-summary") {
  return graphCommunitySummaryDrawer(summary, communityFreeText(current, communityId));
}
```

- [ ] **Step 5: Wire community dialogue handlers in `App.tsx`**

Import `graphCommunitySummaryDrawer` and the new action resolver:

```ts
import {
  artifactDrawer,
  closedDrawer,
  type DrawerState,
  graphCommunitySummaryDrawer,
  graphReaderDrawer,
  graphSelectionDrawer,
  shouldApplyGraphReaderResult,
  wikiDrawer,
} from "@/lib/drawer-state";
import { communityDrawerActionById } from "@/lib/graph-community-drawer";
```

Add handlers next to the existing graph selection handlers:

```ts
const handleGraphCommunityTextChange = useCallback((value: string) => {
  setDrawer((current) => (
    current.mode === "graph-community-summary"
      ? graphCommunitySummaryDrawer(current.payload, value)
      : current
  ));
}, []);

const handleGraphCommunityAsk = (actionId: string | null, newConversation: boolean) => {
  if (!graphData || drawer.mode !== "graph-community-summary") return;
  const selection = resolveSelection(graphData, { kind: "community", id: drawer.payload.communityId });
  const action = communityDrawerActionById(actionId);
  const payload = buildSelectionPromptPayload(graphData, selection, action, drawer.freeText);
  void handleAskSelection({
    message: payload.expandedText,
    displayText: payload.displayText,
    newConversation,
  });
  setDrawer(closedDrawer());
  setSelectionCommand({ id: Math.random().toString(36).slice(2, 10), type: "clear" });
};
```

Pass the handlers into `RightDrawer`:

```tsx
<RightDrawer
  drawer={drawer}
  fullscreen={drawerFullscreen}
  width={drawerWidth}
  defaultWidth={DEFAULT_DRAWER_WIDTH}
  onSelectArtifact={(id) => setDrawer(artifactDrawer(artifacts, id))}
  onOpenPage={handleOpenPage}
  onWikiLinkSeen={handleWikiLinkSeen}
  onGraphReaderAction={handleGraphReaderAction}
  onGraphSummaryCommand={handleGraphSummaryCommand}
  onGraphSummaryNodeSelect={handleGraphSummaryNodeSelect}
  onGraphSummaryNodePreview={handleGraphSummaryNodePreview}
  onGraphSelectionTextChange={handleGraphSelectionTextChange}
  onGraphSelectionNeighbors={handleGraphSelectionNeighbors}
  onGraphSelectionAsk={handleGraphSelectionAsk}
  onGraphCommunityTextChange={handleGraphCommunityTextChange}
  onGraphCommunityAsk={handleGraphCommunityAsk}
  onResize={setDrawerWidth}
  onToggleFullscreen={() => setDrawerFullscreen((value) => !value)}
  onClose={handleCloseDrawer}
/>
```

- [ ] **Step 6: Run the routing tests**

Run:

```bash
node --import tsx --test workbench/web/test/graph-summary-actions.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit drawer state and prompt flow**

Run:

```bash
git add workbench/web/src/lib/drawer-state.ts workbench/web/src/lib/graph-summary-actions.ts workbench/web/src/App.tsx workbench/web/test/graph-summary-actions.test.ts
git commit -m "feat: route community drawer prompts"
```

Expected: commit succeeds.

---

### Task 4: Unified Community Drawer UI

**Files:**
- Modify: `workbench/web/src/components/GraphSummaryDrawer.tsx`
- Modify: `workbench/web/src/components/RightDrawer.tsx`
- Modify: `workbench/web/src/index.css`
- Test: `workbench/web/test/right-drawer-graph-summary.test.tsx`

- [ ] **Step 1: Write failing render tests for the unified drawer**

Update the community render test in `workbench/web/test/right-drawer-graph-summary.test.tsx`:

```ts
it("renders unified community drawer with overview, fixed actions, core nodes, and dialogue controls", () => {
  const html = renderDrawer(graphCommunitySummaryDrawer(communitySummaryFixture()));

  assert.match(html, /data-testid="graph-community-summary"/);
  assert.match(html, /Alpha community/);
  assert.match(html, /进入社区/);
  assert.match(html, /总结这一簇/);
  assert.match(html, /找知识缺口/);
  assert.match(html, /生成主题页/);
  assert.match(html, /探索潜在关系/);
  assert.match(html, /补充说明（可选）/);
  assert.match(html, /发送/);
  assert.match(html, /新对话/);
  assert.match(html, /Alpha node/);
  assert.doesNotMatch(html, /暂无搜索命中/);
  assert.doesNotMatch(html, /暂无固定节点/);
  assert.doesNotMatch(html, /暂无桥接关系/);
});

it("renders ungrouped community without enter-community and recommends relation exploration", () => {
  const html = renderDrawer(graphCommunitySummaryDrawer(communitySummaryFixture({
    communityId: "_none",
    label: "未分组",
    structureState: "ungrouped",
    description: "这些页面暂未形成明确社区。你可以让 agent 探索它们之间是否存在潜在关系。",
    canEnterCommunity: false,
    commands: []
  })));

  assert.match(html, /未分组/);
  assert.match(html, /暂未形成明确社区/);
  assert.match(html, /data-recommended="true"[^>]*>[\s\S]*探索潜在关系/);
  assert.doesNotMatch(html, /进入社区/);
});
```

Update `communitySummaryFixture()` so it includes the fields from Task 1:

```ts
pageCount: 12,
linkCount: 8,
isolatedCount: 1,
structureState: "clear",
description: "这组页面围绕同一主题聚在一起。你可以先看结构，也可以直接让 agent 基于这一组页面继续工作。",
canEnterCommunity: true,
coreNodes: [
  { nodeId: "alpha-node", label: "Alpha node", type: "topic", role: "核心" },
  { nodeId: "beta-node", label: "Beta node", type: "entity", role: "相关" },
  { nodeId: "gamma-node", label: "Gamma node", type: "source", role: "相关" },
  { nodeId: "delta-node", label: "Delta node", type: "entity", role: "相关" },
],
```

- [ ] **Step 2: Run the failing render test**

Run:

```bash
node --import tsx --test workbench/web/test/right-drawer-graph-summary.test.tsx
```

Expected: fail because the community drawer still renders the old heavy summary.

- [ ] **Step 3: Update `RightDrawer` props and community render call**

In `workbench/web/src/components/RightDrawer.tsx`, add props:

```ts
onGraphCommunityTextChange: (value: string) => void;
onGraphCommunityAsk: (actionId: string | null, newConversation: boolean) => void;
```

Destructure them with the existing props:

```ts
onGraphCommunityTextChange,
onGraphCommunityAsk,
```

Update the community render:

```tsx
{drawer.mode === "graph-community-summary" && (
  <GraphCommunitySummary
    payload={drawer.payload}
    freeText={drawer.freeText}
    onFreeTextChange={onGraphCommunityTextChange}
    onAsk={(action) => onGraphCommunityAsk(action?.id ?? null, false)}
    onAskInNewConversation={(action) => onGraphCommunityAsk(action?.id ?? null, true)}
    onCommand={onGraphSummaryCommand}
    onShowNodeSummary={onGraphSummaryNodeSelect}
    onPreviewNode={onGraphSummaryNodePreview}
  />
)}
```

Update `renderDrawer()` in the test to provide no-op handlers:

```ts
onGraphCommunityTextChange: noopString,
onGraphCommunityAsk: noopSelectionAsk,
```

- [ ] **Step 4: Replace the community summary component**

In `workbench/web/src/components/GraphSummaryDrawer.tsx`, update imports:

```ts
import React, { useState } from "react";
import { ArrowRight, MessageSquarePlus, Send } from "lucide-react";
import type {
  GraphCommunitySummaryPayload,
  GraphExcludedObjectPayload,
  GraphGlobalOverviewPayload,
  GraphNodeSummaryPayload,
  GraphSearchResultsPayload,
  GraphSummaryCommand,
  GraphUnavailableObjectPayload,
  SelectionAction,
} from "@llm-wiki/graph-engine";
import { graphCommunityDrawerViewModel, type GraphCommunityDrawerAction } from "../lib/graph-community-drawer";
```

Update `CommunitySummaryProps`:

```ts
interface CommunitySummaryProps {
  payload: GraphCommunitySummaryPayload;
  freeText: string;
  onFreeTextChange: (value: string) => void;
  onAsk: (action: SelectionAction | null) => void;
  onAskInNewConversation: (action: SelectionAction | null) => void;
  onCommand: (command: GraphSummaryCommand) => void;
  onShowNodeSummary: (nodeId: string) => void;
  onPreviewNode: (nodeId: string | null) => void;
}
```

Replace `GraphCommunitySummary` with:

```tsx
export function GraphCommunitySummary({
  payload,
  freeText,
  onFreeTextChange,
  onAsk,
  onAskInNewConversation,
  onCommand,
  onShowNodeSummary,
  onPreviewNode,
}: CommunitySummaryProps) {
  const [coreExpanded, setCoreExpanded] = useState(false);
  const view = graphCommunityDrawerViewModel(payload);
  const coreNodes = coreExpanded ? payload.coreNodes : view.coreNodes;
  const enterCommand = payload.commands.find((command) => command.kind === "enter-community") ?? null;
  const canSendFreeText = freeText.trim().length > 0;
  const defaultAction = view.actions.find((action) => action.recommended) ?? view.actions[0] ?? null;

  return (
    <article className="graph-community-drawer" data-testid="graph-community-summary">
      <header className="graph-community-overview">
        <div className="graph-community-overview-main">
          <div className="graph-summary-kicker">{view.kicker}</div>
          <h2 className="graph-summary-title">{view.title}</h2>
          <p className="graph-summary-excerpt">{view.description}</p>
        </div>
        {view.canEnterCommunity && enterCommand && (
          <button type="button" className="graph-community-enter" onClick={() => onCommand(enterCommand)}>
            进入社区
            <ArrowRight />
          </button>
        )}
      </header>

      <div className="graph-summary-facts">
        {view.facts.map((fact) => (
          <SummaryFact key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </div>

      <div className="graph-summary-meta">
        {view.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>

      <section className="graph-community-action-grid" aria-label="社区动作">
        {view.actions.map((action) => (
          <CommunityActionButton key={action.id} action={action} onClick={() => onAsk(action)} />
        ))}
      </section>

      <section className="graph-summary-section">
        <div className="graph-summary-section-header">
          <h3>核心节点</h3>
          {payload.coreNodes.length > 3 && (
            <button
              type="button"
              className="graph-summary-inline-action"
              onClick={() => setCoreExpanded((value) => !value)}
            >
              {coreExpanded ? "收起" : "查看全部"}
            </button>
          )}
        </div>
        {coreNodes.length === 0 ? (
          <div className="graph-summary-muted">暂无核心节点</div>
        ) : (
          <ul className="graph-community-core-list">
            {coreNodes.map((node) => (
              <li key={node.nodeId}>
                <button
                  type="button"
                  className="graph-community-core-node"
                  onMouseEnter={() => onPreviewNode(node.nodeId)}
                  onMouseLeave={() => onPreviewNode(null)}
                  onFocus={() => onPreviewNode(node.nodeId)}
                  onBlur={() => onPreviewNode(null)}
                  onClick={() => onShowNodeSummary(node.nodeId)}
                >
                  <span>{node.label}</span>
                  <small>{node.role}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="graph-community-dialogue" aria-label="社区对话">
        <textarea
          className="graph-selection-textarea"
          value={freeText}
          onChange={(event) => onFreeTextChange(event.target.value)}
          rows={3}
          placeholder="补充说明（可选）"
        />
        <div className="graph-selection-footer">
          <button
            type="button"
            className="graph-selection-send"
            onClick={() => onAsk(null)}
            disabled={!canSendFreeText}
          >
            <Send />
            发送
          </button>
          <button
            type="button"
            className="graph-selection-secondary"
            onClick={() => onAskInNewConversation(canSendFreeText ? null : defaultAction)}
            disabled={!canSendFreeText && !defaultAction}
          >
            <MessageSquarePlus />
            新对话
          </button>
        </div>
      </section>
    </article>
  );
}

function CommunityActionButton({ action, onClick }: { action: GraphCommunityDrawerAction; onClick: () => void }) {
  return (
    <button
      type="button"
      className="graph-community-action"
      data-action-id={action.id}
      data-recommended={action.recommended ? "true" : "false"}
      onClick={onClick}
    >
      <Send />
      <span>{action.label}</span>
    </button>
  );
}
```

- [ ] **Step 5: Add CSS for the unified drawer**

In `workbench/web/src/index.css`, add these styles near the graph summary styles:

```css
.graph-community-drawer {
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-radius: 16px;
  border: 1px solid rgba(94, 72, 48, 0.14);
  background: var(--paper-grain), rgba(255, 252, 246, 0.94);
  box-shadow: var(--shadow-lg);
  padding: 18px;
}

.graph-community-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.graph-community-overview-main {
  min-width: 0;
}

.graph-community-enter,
.graph-community-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  border: 1px solid rgba(94, 72, 48, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--foreground);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.2;
  box-shadow: var(--shadow);
}

.graph-community-enter svg,
.graph-community-action svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.graph-community-enter:hover,
.graph-community-action:hover {
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(94, 72, 48, 0.28);
}

.graph-community-action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.graph-community-action[data-recommended="true"] {
  border-color: rgba(124, 92, 46, 0.42);
  background: rgba(238, 220, 184, 0.54);
}

.graph-community-core-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.graph-community-core-node {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  border: 1px solid rgba(94, 72, 48, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.52);
  padding: 9px 10px;
  color: inherit;
  text-align: left;
}

.graph-community-core-node span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-community-core-node small {
  color: var(--muted-foreground);
  font-size: 12px;
}

.graph-community-dialogue {
  display: grid;
  gap: 10px;
}
```

Add a compact media query in the existing responsive area:

```css
@media (max-width: 720px) {
  .graph-community-overview {
    grid-template-columns: minmax(0, 1fr);
  }

  .graph-community-enter {
    justify-self: start;
  }

  .graph-community-action-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 6: Run the render test**

Run:

```bash
node --import tsx --test workbench/web/test/right-drawer-graph-summary.test.tsx
```

Expected: pass.

- [ ] **Step 7: Commit the unified drawer UI**

Run:

```bash
git add workbench/web/src/components/GraphSummaryDrawer.tsx workbench/web/src/components/RightDrawer.tsx workbench/web/src/index.css workbench/web/test/right-drawer-graph-summary.test.tsx
git commit -m "feat: unify community drawer layout"
```

Expected: commit succeeds.

---

### Task 5: `+邻居` And Sigma Shift Multi-Select

**Files:**
- Modify: `packages/graph-engine/src/types.ts`
- Modify: `packages/graph-engine/src/summary/index.ts`
- Modify: `packages/graph-engine/src/select/index.ts`
- Modify: `packages/graph-engine/src/render/sigma-hit-projector.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-types.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Modify: `packages/graph-engine/src/facade.ts`
- Modify: `workbench/web/src/App.tsx`
- Test: `packages/graph-engine/test/summary-contract.test.ts`
- Test: `packages/graph-engine/test/select.test.ts`
- Test: `packages/graph-engine/test/sigma-global-renderer.test.ts`

- [ ] **Step 1: Write failing tests for node neighbor command**

In `packages/graph-engine/test/summary-contract.test.ts`, update the command expectations:

```ts
assert.deepEqual(commandKinds(node.commands), ["open-detail-read", "select-neighbors", "set-fixed-position", "enter-community"]);
```

Add this assertion in the same test:

```ts
const selectNeighbors = node.commands.find((command) => command.kind === "select-neighbors");
assert.deepEqual(selectNeighbors, {
  kind: "select-neighbors",
  nodeId: "a",
  label: "+邻居"
});
```

- [ ] **Step 2: Add `select-neighbors` to node summary commands**

In `packages/graph-engine/src/summary/index.ts`, update `nodeSummaryCommands`:

```ts
const commands: GraphSummaryCommand[] = [
  {
    kind: "open-detail-read",
    nodeId: node.id,
    path: wikiPathForGraphNode(node),
    label: "打开详情"
  },
  {
    kind: "select-neighbors",
    nodeId: node.id,
    label: "+邻居"
  },
  {
    kind: "set-fixed-position",
    mode: pinHint.pinned ? "unfix" : "fix",
    nodeId: node.id,
    wikiPath: wikiPathForGraphNode(node),
    label: pinHint.pinned ? "取消固定位置" : "固定位置"
  }
];
```

- [ ] **Step 3: Wire `select-neighbors` in App command handling**

In `workbench/web/src/App.tsx`, update `graphSummaryCommandSignature`:

```ts
if (command.kind === "select-neighbors") return `${command.kind}:${command.nodeId}`;
```

Add this branch to `handleGraphSummaryCommand` before `set-fixed-position`:

```ts
if (command.kind === "select-neighbors") {
  setSelectionCommand({
    id: command.nodeId,
    type: "neighbors",
  });
  return;
}
```

- [ ] **Step 4: Write failing Shift toggle tests**

In `packages/graph-engine/test/select.test.ts`, import `toggleNodeInSelection`:

```ts
import { resolveSelection, resolveSelectionForCapabilities, toggleNodeInSelection } from "../src/select";
```

Add tests:

```ts
it("toggles Sigma Shift node clicks into stable manual node selections", () => {
  const data = multicommGraph();

  assert.deepEqual(toggleNodeInSelection(data, null, "a1"), { kind: "node", id: "a1" });
  assert.deepEqual(toggleNodeInSelection(data, { kind: "node", id: "a1" }, "a2"), { kind: "nodes", ids: ["a1", "a2"] });
  assert.deepEqual(toggleNodeInSelection(data, { kind: "nodes", ids: ["a1", "a2"] }, "a1"), { kind: "node", id: "a2" });
  assert.equal(toggleNodeInSelection(data, { kind: "node", id: "a1" }, "a1"), null);
});

it("toggles from a community selection without losing graph order", () => {
  const data = multicommGraph();

  assert.deepEqual(toggleNodeInSelection(data, { kind: "community", id: "alpha" }, "b1"), {
    kind: "nodes",
    ids: ["a1", "a2", "a3", "b1"]
  });
});
```

- [ ] **Step 5: Implement Shift toggle helper**

In `packages/graph-engine/src/select/index.ts`, import the `_none` constant:

```ts
  UNGROUPED_COMMUNITY_ID
```

Add this exported helper after `resolveSelectionForCapabilities`:

```ts
export function toggleNodeInSelection(
  data: GraphData,
  current: SelectionInput | null | undefined,
  nodeId: NodeId
): SelectionInput | null {
  const index = buildSelectionGraphIndex(data);
  if (!index.nodeById.has(nodeId)) return current ?? null;
  const currentIds = current ? selectionNodeIds(index, current) : [];
  const selected = new Set(currentIds);
  if (selected.has(nodeId)) {
    selected.delete(nodeId);
  } else {
    selected.add(nodeId);
  }
  const ids = index.nodes.map((node) => node.id).filter((id) => selected.has(id));
  if (ids.length === 0) return null;
  if (ids.length === 1) return { kind: "node", id: ids[0] };
  return { kind: "nodes", ids };
}
```

Update `toSelectionNode`:

```ts
community: String(node.community || UNGROUPED_COMMUNITY_ID),
```

- [ ] **Step 6: Write failing Sigma additive event test**

In `packages/graph-engine/test/sigma-global-renderer.test.ts`, add a test near the existing click tests:

```ts
it("passes Shift-click additive context from Sigma node clicks", () => {
  const runtime = fakeRuntime();
  const hits: Array<{ target: unknown; additive: boolean }> = [];
  const renderer = createSigmaGlobalRenderer({
    container: fakeContainer(),
    adapterData: adapterDataFixture(),
    theme: "shan-shui",
    runtime,
    onHitTarget: (target, context) => hits.push({ target, additive: Boolean(context?.additive) })
  });
  const sigma = runtime.instances[0];

  sigma.emit("clickNode", { node: "render-beta", event: { shiftKey: true } });
  sigma.emit("clickNode", { node: "render-alpha", event: { shiftKey: false } });

  assert.deepEqual(hits, [
    { target: { kind: "node", id: "render-beta" }, additive: true },
    { target: { kind: "node", id: "render-alpha" }, additive: false }
  ]);

  renderer.destroy();
});
```

- [ ] **Step 7: Pass additive context from Sigma renderer**

In `packages/graph-engine/src/render/sigma-hit-projector.ts`, update `SigmaGlobalHitInput`:

```ts
export interface SigmaGlobalHitInput {
  nodeId?: string | null;
  screenPoint?: GraphScreenPoint | null;
  renderedObject?: SigmaGlobalRenderedObject | null;
  additive?: boolean;
}
```

Add this exported helper:

```ts
export function sigmaAdditiveFromPayload(payload: unknown): boolean {
  const candidate = payload as {
    shiftKey?: unknown;
    event?: { shiftKey?: unknown; original?: { shiftKey?: unknown }; originalEvent?: { shiftKey?: unknown } };
    originalEvent?: { shiftKey?: unknown };
  } | null;
  return candidate?.shiftKey === true
    || candidate?.event?.shiftKey === true
    || candidate?.event?.original?.shiftKey === true
    || candidate?.event?.originalEvent?.shiftKey === true
    || candidate?.originalEvent?.shiftKey === true;
}
```

In `packages/graph-engine/src/render/sigma-global-types.ts`, add:

```ts
export interface SigmaGlobalHitContext {
  additive: boolean;
}
```

Update the renderer option:

```ts
onHitTarget?: (target: GraphGestureTarget, context: SigmaGlobalHitContext) => void;
```

In `packages/graph-engine/src/render/sigma-global-renderer.ts`, import `sigmaAdditiveFromPayload` and update click handlers:

```ts
const nodeClick = (payload?: unknown): void => {
  const nodeId = sigmaNodeIdFromPayload(payload);
  if (consumeSuppressedNodeClick(nodeId)) return;
  handleSigmaHit({ nodeId, additive: sigmaAdditiveFromPayload(payload) });
};
const stageClick = (payload?: unknown): void => handleSigmaHit({
  screenPoint: sigmaScreenPointFromPayload(payload),
  additive: sigmaAdditiveFromPayload(payload)
});
```

Update `handleSigmaHit`:

```ts
options.onHitTarget?.(target, { additive: Boolean(input.additive) });
```

- [ ] **Step 8: Convert additive Sigma hits into multi-select**

In `packages/graph-engine/src/facade.ts`, import:

```ts
  toggleNodeInSelection,
```

Import the context type:

```ts
import type { SigmaGlobalHitContext } from "./render/sigma-global-types";
```

Update the handler signature and node branch:

```ts
function handleSigmaHitTarget(target: GraphGestureTarget, context: SigmaGlobalHitContext): void {
  switch (target.kind) {
    case "node":
      if (target.id) selectSigmaNode(target.id, context.additive);
      break;
```

Add this helper near `selectOnSigma`:

```ts
function selectSigmaNode(nodeId: NodeId, additive: boolean): void {
  if (!additive) {
    selectOnSigma({ kind: "node", id: nodeId });
    return;
  }
  const nextSelection = toggleNodeInSelection(options.data, options.selection, nodeId);
  if (!nextSelection) {
    input.options.callbacks.onSelectionClearRequested?.();
    updateSigmaSelection(null);
    return;
  }
  selectOnSigma(nextSelection);
}
```

- [ ] **Step 9: Run targeted graph-engine tests**

Run:

```bash
node --import tsx --test packages/graph-engine/test/summary-contract.test.ts packages/graph-engine/test/select.test.ts packages/graph-engine/test/sigma-global-renderer.test.ts
```

Expected: pass.

- [ ] **Step 10: Commit selection entries**

Run:

```bash
git add packages/graph-engine/src/types.ts packages/graph-engine/src/summary/index.ts packages/graph-engine/src/select/index.ts packages/graph-engine/src/render/sigma-hit-projector.ts packages/graph-engine/src/render/sigma-global-types.ts packages/graph-engine/src/render/sigma-global-renderer.ts packages/graph-engine/src/facade.ts packages/graph-engine/test/summary-contract.test.ts packages/graph-engine/test/select.test.ts packages/graph-engine/test/sigma-global-renderer.test.ts workbench/web/src/App.tsx
git commit -m "fix: restore graph selection entry points"
```

Expected: commit succeeds.

---

### Task 6: Full Verification, Browser QA, And Release Docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Run graph-engine test suite**

Run:

```bash
npm run test -w @llm-wiki/graph-engine
```

Expected: all graph-engine tests pass.

- [ ] **Step 2: Run targeted web tests**

Run:

```bash
node --import tsx --test workbench/web/test/graph-community-drawer.test.ts workbench/web/test/graph-summary-actions.test.ts workbench/web/test/right-drawer-graph-summary.test.tsx workbench/web/test/graph-selection-drawer.test.ts
```

Expected: all targeted web tests pass.

- [ ] **Step 3: Run full web test, lint, and typecheck**

Run:

```bash
npm run test -w @llm-wiki-agent/web
npm run lint -w @llm-wiki-agent/web
npm run typecheck
```

Expected: all commands exit with code 0.

- [ ] **Step 4: Update changelog**

Add this at the top of `CHANGELOG.md`:

```md
## v3.6.16 (2026-06-28)

### 改进

- 工作台图谱社区抽屉统一：普通社区和“未分组”现在使用同一套概览、固定动作、核心节点和对话入口；“进入社区”移到顶部，未分组默认推荐探索潜在关系。

### 修复

- 修复 Sigma 全局图迁移后遗留的选择入口缺口：单节点摘要恢复“+邻居”，Shift+点击节点恢复多选。
```

- [ ] **Step 5: Update README feature copy**

Change the version badge in `README.md`:

```md
[![version](https://img.shields.io/badge/v3.6.16-社区抽屉统一-E8D5B5?style=flat-square&labelColor=3a3026&color=E8D5B5)](https://github.com/sdyckjq-lab/llm-wiki-skill/releases)
```

Update the preview sentence:

```md
东方编辑部 × 数字山水风交互式知识图谱 — 双击 HTML 文件即可在浏览器中探索。搜索、社区图例、聚焦筛选、节点视觉分层、社区轻量地图、统一社区抽屉、悬停预览、轻量摘要、明确进入阅读、Shift 多选、画布缩放拖拽和小地图定位，全部离线运行，不依赖服务器。
```

Update the “本地阅读动线” row:

```md
| 🎓 | **本地阅读动线** | 社区图例、聚焦筛选、图谱搜索、右侧摘要/阅读抽屉和选区抽屉保持联动；普通社区和未分组使用统一社区抽屉，社区先摘要再进入聚焦 |
```

Add this item in the full feature list after “大图谱全局路线”:

```md
- **统一社区抽屉** — 普通社区和“未分组”使用同一套概览、固定动作、核心节点和对话入口；“进入社区”放在顶部，未分组默认推荐探索潜在关系
```

- [ ] **Step 6: Run docs sanity checks**

Run:

```bash
bash install.sh --dry-run --platform codex
grep -r '本机用户路径\|真实姓名\|私有素材路径' scripts/ templates/ tests/ SKILL.md
```

Expected: dry run succeeds; grep prints no matches.

- [ ] **Step 7: Run browser QA**

Start the app:

```bash
npm run dev
```

Expected: server starts with backend on `8787` and frontend on `5180`. Keep the session open for browser validation.

In Chrome at `http://localhost:5180/`, validate:

```md
1. Open the graph tab.
2. Click a normal community. The right drawer shows the same v3 structure as the reference image, with “进入社区” at the top.
3. Click “进入社区”. The app enters the community reading view.
4. Return to the global graph.
5. Click “未分组”. The right drawer keeps the same structure, does not show “进入社区”, and highlights “探索潜在关系”.
6. Click a normal community and then “未分组”. The drawer changes content and recommendation only; it does not switch into the old selection panel.
7. Click a single node. The node summary contains “+邻居”.
8. Click “+邻居”. The drawer opens a multi-page selection containing the node and one-hop neighbors.
9. Shift+click two nodes in the Sigma global graph. The drawer opens a multi-node selection.
10. Type a short note in the community drawer and click “发送”. The chat view receives a compact selection mention rather than a long pasted structure block.
```

Stop the dev server after validation.

- [ ] **Step 8: Commit docs and verification updates**

Run:

```bash
git add CHANGELOG.md README.md
git commit -m "docs: describe unified community drawer"
```

Expected: commit succeeds.

- [ ] **Step 9: Final branch status**

Run:

```bash
git status --short --branch
git log --oneline --decorate -6
```

Expected: branch is `codex/unified-community-drawer-design`; working tree is clean; recent commits show the implementation, tests, and docs commits.

---

## Self-Review

**Spec coverage:** The plan covers `_none` as a virtual community, unified normal/ungrouped community drawer, top “进入社区”, fixed action area, “探索潜在关系” recommendation rules, compact core nodes, community dialogue flow, single-node “+邻居”, Sigma Shift multi-select, tests, browser validation, and release docs.

**Placeholder scan:** The plan avoids deferred work markers and gives concrete file paths, snippets, commands, and expected outcomes for each step.

**Type consistency:** New fields are introduced in `GraphCommunitySummaryPayload` before frontend code uses them. `select-neighbors` is added to `GraphSummaryCommand` before `App.tsx` handles it. Community fixed action IDs use existing `SelectionActionId` values.
