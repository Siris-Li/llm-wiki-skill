import type {
  Community,
  GraphEdge,
  GraphNode,
  GraphWarningCode,
  GraphWarningGroup,
} from "../types";

export interface NormalizedGraphCollections {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: Community[];
  warnings: GraphWarningGroup[];
}

type CollectionKind = "node" | "edge";

export function normalizeGraphInputCollections(
  input: unknown,
  inputWarnings: readonly GraphWarningGroup[] = [],
): NormalizedGraphCollections {
  const raw = objectRecord(input);
  const warnings = mergeWarnings(inputWarnings);
  const nodeRows = arrayEntries(raw.nodes);
  const edgeRows = arrayEntries(raw.edges);

  const nodes = normalizeUniqueRows({
    rows: nodeRows,
    length: arrayLength(raw.nodes),
    kind: "node",
    normalize: projectNode,
    warnings,
  });
  const nodeIds = new Set<string>();
  nodes.forEach((node) => nodeIds.add(node.id));
  const normalizedEdges = normalizeUniqueRows({
    rows: edgeRows,
    length: arrayLength(raw.edges),
    kind: "edge",
    normalize: projectEdge,
    warnings,
  });
  const edges = normalizedEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const communities = normalizeUniqueCommunities(raw.learning, warnings);

  return { nodes, edges, communities, warnings: Array.from(warnings.values()) };
}

function normalizeUniqueRows<T extends GraphNode | GraphEdge>({
  rows,
  length,
  kind,
  normalize,
  warnings,
}: {
  rows: Array<{ raw: Record<string, unknown>; index: number }>;
  length: number;
  kind: CollectionKind;
  normalize: (raw: Record<string, unknown>, index: number, id: string) => T;
  warnings: Map<string, GraphWarningGroup>;
}): T[] {
  const explicitIds = new Set<string>();
  for (const row of rows) {
    const raw = row.raw;
    if (raw.id != null) explicitIds.add(compatibleString(raw.id, `${kind}-${row.index}`));
  }

  const usedIds = new Set<string>();
  const output = new Array<T>(length);
  let generatedIndex = 0;
  let outputIndex = 0;
  let previousInputIndex = -1;

  for (const row of rows) {
    outputIndex += row.index - previousInputIndex - 1;
    previousInputIndex = row.index;
    const raw = row.raw;
    const explicitId = raw.id == null ? null : compatibleString(raw.id, `${kind}-${row.index}`);
    let id = explicitId;
    if (id == null) {
      id = `${kind}-${generatedIndex}`;
      while (explicitIds.has(id) || usedIds.has(id)) {
        addWarning(warnings, engineWarning(
          "generated_id_collision",
          "warning",
          id,
          `Generated ${kind} id ${id} was already occupied`,
        ));
        generatedIndex += 1;
        id = `${kind}-${generatedIndex}`;
      }
      generatedIndex += 1;
    } else if (usedIds.has(id)) {
      addWarning(warnings, engineWarning(
        kind === "node" ? "duplicate_node_id" : "duplicate_edge_id",
        "error",
        id,
        `Duplicate ${kind} id ${id} was ignored`,
      ));
      continue;
    }

    usedIds.add(id);
    output[outputIndex] = normalize(raw, row.index, id);
    outputIndex += 1;
  }

  output.length = outputIndex + Math.max(0, length - previousInputIndex - 1);

  return output;
}

function normalizeUniqueCommunities(
  learningValue: unknown,
  warnings: Map<string, GraphWarningGroup>,
): Community[] {
  const learning = objectRecord(learningValue);
  const rows = arrayEntries(learning.communities);
  const seen = new Set<string>();
  const communities: Community[] = [];

  for (const row of rows) {
    const raw = row.raw;
    if (raw.id == null) continue;
    const id = compatibleString(raw.id, "");
    if (seen.has(id)) {
      addWarning(warnings, engineWarning(
        "duplicate_community_id",
        "error",
        id,
        `Duplicate community id ${id} was ignored`,
      ));
      continue;
    }
    seen.add(id);
    communities.push({
      ...raw,
      id,
      label: compatibleString(raw.label, id),
      node_count: compatibleCount(raw.node_count, 0),
      source_count: compatibleCount(raw.source_count, 0),
      recommended_start_node_id: compatibleNullableString(raw.recommended_start_node_id),
    } as Community);
  }

  return communities;
}

function projectNode(raw: Record<string, unknown>, index: number, id: string): GraphNode {
  const node = { ...raw, id } as Record<string, unknown>;
  copyCompatibleStrings(node, raw, [
    "label", "type", "community", "source_path", "source", "path", "content", "summary",
    "date", "updated_at", "updatedAt", "created_at", "createdAt", "source_title", "source_url",
    "url", "author", "source_name", "confidence", "type_confidence",
  ]);
  copyCompatibleNumbers(node, raw, ["x", "y", "weight", "score"]);
  return node as GraphNode;
}

function projectEdge(raw: Record<string, unknown>, index: number, id: string): GraphEdge {
  const edge = {
    ...raw,
    id,
    from: endpointId(raw.from != null ? raw.from : raw.source),
    to: endpointId(raw.to != null ? raw.to : raw.target),
    type: compatibleString(raw.type ?? raw.confidence ?? raw.type_confidence, "UNVERIFIED"),
  } as Record<string, unknown>;
  copyCompatibleStrings(edge, raw, [
    "confidence", "type_confidence", "relation_type", "relationship_type", "relation",
  ]);
  copyCompatibleNumbers(edge, raw, ["weight"]);
  return edge as GraphEdge;
}

function engineWarning(
  code: GraphWarningCode,
  severity: "error" | "warning",
  id: string,
  message: string,
): GraphWarningGroup {
  return {
    warning_id: `${code}:${id}`,
    code,
    severity,
    message,
    id,
    occurrence_count: 0,
    occurrences: [],
  };
}

function mergeWarnings(inputWarnings: readonly GraphWarningGroup[]): Map<string, GraphWarningGroup> {
  const warnings = new Map<string, GraphWarningGroup>();
  for (const warning of inputWarnings) addWarning(warnings, warning);
  return warnings;
}

function addWarning(warnings: Map<string, GraphWarningGroup>, warning: GraphWarningGroup): void {
  if (!warnings.has(warning.warning_id)) warnings.set(warning.warning_id, warning);
}

function arrayEntries(value: unknown): Array<{ raw: Record<string, unknown>; index: number }> {
  if (!Array.isArray(value)) return [];
  const entries: Array<{ raw: Record<string, unknown>; index: number }> = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) continue;
      try {
        entries.push({ raw: objectRecord(value[index]), index });
      } catch {
        entries.push({ raw: {}, index });
      }
    }
  } catch {
    return entries;
  }
  return entries;
}

function arrayLength(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  try {
    return value.length;
  } catch {
    return 0;
  }
}

function endpointId(value: unknown): string {
  const endpoint = objectRecord(value);
  if (endpoint.id != null) return compatibleString(endpoint.id, "");
  return value == null ? "" : compatibleString(value, "");
}

function compatibleCount(value: unknown, fallback: number): number {
  return finiteNumber(value, fallback);
}

function compatibleNullableString(value: unknown): string | null {
  return value == null ? null : compatibleString(value, "") || null;
}

function compatibleString(value: unknown, fallback: string): string {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") return {};
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  try {
    for (const key of Object.keys(value)) {
      try {
        output[key] = (value as Record<string, unknown>)[key];
      } catch {
        // Keep the rest of a hostile row readable.
      }
    }
  } catch {
    return {};
  }
  return output;
}

function copyCompatibleStrings(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: string[],
): void {
  for (const key of keys) {
    if (source[key] != null) target[key] = compatibleString(source[key], "");
  }
}

function copyCompatibleNumbers(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: string[],
): void {
  for (const key of keys) {
    if (source[key] == null) continue;
    const number = finiteNumber(source[key], Number.NaN);
    if (Number.isFinite(number)) target[key] = number;
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}
