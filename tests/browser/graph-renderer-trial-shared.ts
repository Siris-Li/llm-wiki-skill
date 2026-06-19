import type { LargeGraphFixtureId, LargeGraphFixtureMetadata } from "../../packages/graph-engine/test/large-graph-fixtures";

export const FULL_TRIAL_SHAPES: LargeGraphFixtureId[] = [
  "real-snapshot-proxy",
  "nodes-1000-sparse",
  "nodes-1000-dense",
  "nodes-5000-sparse",
  "nodes-5000-dense",
  "nodes-10000-aggregation",
  "nodes-10000-high-edge",
  "oversized-community",
  "many-small-communities",
  "many-search-hits",
  "many-pin-nodes"
];

export const REQUIRED_TRIAL_ACTIONS = [
  "initial_render",
  "wheel_zoom",
  "pan",
  "search_highlight",
  "point_select",
  "container_select",
  "drawer_open",
  "enter_community",
  "return_global",
  "repeated_search_community_drawer_cycles"
] as const;

export type TrialAction = typeof REQUIRED_TRIAL_ACTIONS[number];

export interface TrialRecordLike {
  graph_shape: string;
  action: string;
  pass: boolean;
  failure_class: string | null;
  failure_detail?: string | null;
}

export function parseRequestedShapes(value: string | undefined): LargeGraphFixtureId[] {
  return (value || FULL_TRIAL_SHAPES.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as LargeGraphFixtureId[];
}

export async function waitForAnimationFrames(page: PageLike, count = 2): Promise<void> {
  await page.evaluate((frameCount: number) => new Promise<void>((resolve) => {
    let remaining = Math.max(1, frameCount);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);
}

export async function waitForAfterDrawing(page: PageLike): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const trial = (window as any).__visTrial;
    if (!trial?.network?.once) {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      return;
    }
    let finished = false;
    const timeout = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error("vis-network afterDrawing did not fire after action"));
    }, 2500);
    const finish = () => requestAnimationFrame(() => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve();
    });
    trial.network.once("afterDrawing", finish);
    trial.network.redraw();
  }));
}

export function memoryGrowthLimitMb(metadata: LargeGraphFixtureMetadata): number {
  if (metadata.nodes >= 10000) return 100;
  if (metadata.nodes >= 5000) return 75;
  return 50;
}

export function memoryGrowthFailureClass(memoryGrowthMb: number | null, metadata: LargeGraphFixtureMetadata): string | null {
  if (memoryGrowthMb == null) return null;
  return memoryGrowthMb <= memoryGrowthLimitMb(metadata) ? null : "memory_growth_above_floor";
}

export function memoryGrowthFailureDetail(memoryGrowthMb: number | null, metadata: LargeGraphFixtureMetadata): string | null {
  if (memoryGrowthMb == null) return "memory_growth_unavailable";
  const limit = memoryGrowthLimitMb(metadata);
  return memoryGrowthMb <= limit ? null : `memory_growth_mb=${memoryGrowthMb}; limit_mb=${limit}`;
}

export function validateTrialResults(input: {
  renderer: string;
  requestedShapes: readonly string[];
  requiredActions?: readonly string[];
  records: readonly TrialRecordLike[];
  errors: readonly string[];
  resultPath: string;
}): void {
  const requiredActions = input.requiredActions ?? REQUIRED_TRIAL_ACTIONS;
  const failures: string[] = [];

  for (const error of input.errors) {
    failures.push(`error: ${error}`);
  }

  for (const shape of input.requestedShapes) {
    const shapeRecords = input.records.filter((record) => record.graph_shape === shape);
    if (!shapeRecords.length) {
      failures.push(`${shape}: no records`);
      continue;
    }
    for (const action of requiredActions) {
      if (!shapeRecords.some((record) => record.action === action)) {
        failures.push(`${shape}: missing action ${action}`);
      }
    }
  }

  for (const record of input.records) {
    if (record.pass === false || record.failure_class) {
      failures.push(`${record.graph_shape}/${record.action}: pass=${record.pass}; failure=${record.failure_class ?? "none"}; detail=${record.failure_detail ?? "none"}`);
    }
  }

  if (failures.length) {
    throw new Error(`${input.renderer} trial failed validation (${failures.length} issue(s)). result=${input.resultPath}\n${failures.slice(0, 20).join("\n")}`);
  }
}

interface PageLike {
  evaluate<T>(fn: Function | string, arg?: unknown): Promise<T>;
}
