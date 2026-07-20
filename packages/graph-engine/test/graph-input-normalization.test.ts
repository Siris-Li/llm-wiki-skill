import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAtlasModel, projectGraphInput } from "../src";

describe("graph input normalization", () => {
  it("keeps the first explicit id and allocates missing ids around every occupied value", () => {
    const input = {
      nodes: [
        { id: "node-0", label: "explicit", source_path: "wiki/entities/explicit.md" },
        { label: "generated", source_path: "wiki/entities/generated.md" },
        { id: "dup", label: "first", source_path: "wiki/entities/first.md" },
        { id: "dup", label: "second", source_path: "wiki/entities/second.md" },
      ],
      edges: [
        { id: "edge-0", from: "node-0", to: "dup", type: "EXTRACTED" },
        { from: "dup", to: "node-0", type: "EXTRACTED" },
        { id: "same", from: "node-0", to: "dup", type: "EXTRACTED" },
        { id: "same", from: "dup", to: "node-0", type: "EXTRACTED" },
      ],
      learning: {
        entry: { recommended_start_node_id: "dup", recommended_start_reason: null, default_mode: "global" },
        views: {
          path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
          community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
          global: { enabled: true, node_ids: ["node-0", "dup"], degraded: false },
        },
        communities: [{ id: "c", label: "first" }, { id: "c", label: "second" }],
      },
    };

    const projection = projectGraphInput(input);
    assert.deepEqual(projection.data.nodes.map((node) => node.id), ["node-0", "node-1", "dup"]);
    assert.deepEqual(projection.data.edges.map((edge) => edge.id), ["edge-0", "edge-1", "same"]);
    assert.equal(projection.data.nodes.find((node) => node.id === "dup")?.label, "first");
    assert.deepEqual(projection.warnings.map((warning) => warning.code).sort(), [
      "duplicate_community_id",
      "duplicate_edge_id",
      "duplicate_node_id",
      "generated_id_collision",
      "generated_id_collision",
    ]);
    assert.equal(projection.warnings.find((warning) => warning.code === "duplicate_node_id")?.severity, "error");
    assert.equal(projection.warnings.find((warning) => warning.code === "generated_id_collision")?.severity, "warning");

    const atlas = buildAtlasModel(input);
    assert.deepEqual(atlas.nodes.map((node) => node.id), ["node-0", "node-1", "dup"]);
    assert.equal(atlas.byId.dup?.label, "first");
    assert.deepEqual(atlas.warnings, projection.warnings);

    const persisted = [{
      warning_id: "broken:missing",
      code: "broken_wikilink" as const,
      severity: "error" as const,
      message: "missing",
      target_key: "missing",
      occurrence_count: 1,
      occurrences: [{
        occurrence_id: "occ:missing",
        source_path: "wiki/topics/source.md",
        line: 1,
        column: 1,
        start_byte: 0,
        end_byte: 11,
        raw_link: "[[missing]]",
        file_sha256: "0".repeat(64),
        link_kind: "page_wikilink" as const,
        read_only: false,
      }],
    }];
    const mergedProjection = projectGraphInput(input, persisted);
    const mergedAtlas = buildAtlasModel(input, persisted);
    assert.equal(mergedProjection.warnings[0]?.warning_id, "broken:missing");
    assert.deepEqual(mergedAtlas.warnings, mergedProjection.warnings);
  });
});
