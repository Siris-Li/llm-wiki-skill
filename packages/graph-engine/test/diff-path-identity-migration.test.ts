import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alignGraphIdentityBySourcePath, diffGraphData } from "../src";
import type { GraphData, GraphEdge, GraphNode } from "../src";

describe("path identity migration diff", () => {
  it("aligns legacy node ids, directed semantic edges, and renamed communities", () => {
    const previous = graph(
      [
        node("alpha", "wiki/entities/alpha.md", "legacy-community"),
        node("beta", "wiki/topics/beta.md", "legacy-community"),
      ],
      [
        edge("legacy-dependency", "alpha", "beta"),
        edge("legacy-contrast", "beta", "alpha", "对比"),
      ],
    );
    const next = graph(
      [
        node("wiki/entities/alpha.md", "wiki/entities/alpha.md", "path-community"),
        node("wiki/topics/beta.md", "wiki/topics/beta.md", "path-community"),
      ],
      [
        edge("path-contrast", "wiki/topics/beta.md", "wiki/entities/alpha.md", "对比"),
        edge("path-dependency", "wiki/entities/alpha.md", "wiki/topics/beta.md", "依赖"),
      ],
    );

    const alignment = alignGraphIdentityBySourcePath(previous, next);
    assert.deepEqual(Array.from(alignment.previousToNext.entries()), [
      ["alpha", "wiki/entities/alpha.md"],
      ["beta", "wiki/topics/beta.md"],
    ]);
    const diff = diffGraphData(previous, next);
    assert.deepEqual(diff.addedNodes, []);
    assert.deepEqual(diff.removedNodes, []);
    assert.deepEqual(diff.addedEdges, []);
    assert.deepEqual(diff.removedEdges, []);
    assert.deepEqual(diff.newCommunities, []);
    assert.deepEqual(diff.migrationWarnings, []);
  });

  it("falls back only to exact ids when source path alignment is ambiguous", () => {
    const previous = graph([
      node("same", "wiki/entities/shared.md", "legacy"),
      node("legacy-extra", "wiki/entities/shared.md", "legacy"),
    ]);
    const next = graph([
      node("same", "wiki/entities/shared.md", "current"),
      node("wiki/entities/shared.md", "wiki/entities/shared.md", "current"),
    ]);

    const alignment = alignGraphIdentityBySourcePath(previous, next);
    assert.deepEqual(Array.from(alignment.previousToNext.entries()), [["same", "same"]]);
    assert.deepEqual(alignment.warnings, [{
      code: "identity_alignment_ambiguous",
      source_path: "wiki/entities/shared.md",
      previous_ids: ["same", "legacy-extra"],
      next_ids: ["same", "wiki/entities/shared.md"],
    }]);

    const diff = diffGraphData(previous, next);
    assert.deepEqual(diff.addedNodes, ["wiki/entities/shared.md"]);
    assert.deepEqual(diff.removedNodes, ["legacy-extra"]);
    assert.deepEqual(diff.migrationWarnings, alignment.warnings);
  });

  it("reports unmatched legacy identities after applying exact-id fallback", () => {
    const previous = graph([
      node("legacy-without-path", undefined, "legacy"),
      node("legacy-stale", "wiki/entities/stale.md", "legacy"),
      node("same", undefined, "legacy"),
    ]);
    const next = graph([
      node("wiki/entities/current.md", "wiki/entities/current.md", "current"),
      node("same", "wiki/entities/same.md", "current"),
    ]);

    const alignment = alignGraphIdentityBySourcePath(previous, next);
    assert.deepEqual(Array.from(alignment.previousToNext.entries()), [["same", "same"]]);
    assert.deepEqual(alignment.warnings, [
      {
        code: "identity_alignment_ambiguous",
        source_path: null,
        previous_ids: ["legacy-without-path"],
        next_ids: [],
      },
      {
        code: "identity_alignment_ambiguous",
        source_path: "wiki/entities/stale.md",
        previous_ids: ["legacy-stale"],
        next_ids: [],
      },
    ]);

    const diff = diffGraphData(previous, next);
    assert.deepEqual(diff.addedNodes, ["wiki/entities/current.md"]);
    assert.deepEqual(diff.removedNodes, ["legacy-without-path", "legacy-stale"]);
    assert.deepEqual(diff.migrationWarnings, alignment.warnings);
  });

  it("aligns all supported legacy source path fields", () => {
    const previous = graph([
      {
        ...node("legacy-source", "", "legacy"),
        source: "wiki\\entities\\.\\source.md",
      },
      {
        ...node("legacy-path", "../outside.md", "legacy"),
        source: "",
        path: "wiki/topics/path.md",
      },
    ]);
    const next = graph([
      node("wiki/entities/source.md", "wiki/entities/source.md", "current"),
      node("wiki/topics/path.md", "wiki/topics/path.md", "current"),
    ]);

    const alignment = alignGraphIdentityBySourcePath(previous, next);
    assert.deepEqual(Array.from(alignment.previousToNext.entries()), [
      ["legacy-source", "wiki/entities/source.md"],
      ["legacy-path", "wiki/topics/path.md"],
    ]);
    assert.deepEqual(alignment.warnings, []);
    assert.deepEqual(diffGraphData(previous, next).addedNodes, []);
    assert.deepEqual(diffGraphData(previous, next).removedNodes, []);
  });

  it("matches repeated legacy semantic edges in stable order and reports real surplus rows", () => {
    const previous = graph(
      [
        node("alpha", "wiki/entities/alpha.md", "legacy"),
        node("beta", "wiki/topics/beta.md", "legacy"),
      ],
      [
        edge("legacy-first", "alpha", "beta"),
        edge("legacy-surplus", "alpha", "beta", "依赖"),
      ],
    );
    const next = graph(
      [
        node("wiki/entities/alpha.md", "wiki/entities/alpha.md", "current"),
        node("wiki/topics/beta.md", "wiki/topics/beta.md", "current"),
      ],
      [
        edge("path-new-relation", "wiki/topics/beta.md", "wiki/entities/alpha.md", "对比"),
        edge("path-match", "wiki/entities/alpha.md", "wiki/topics/beta.md", "依赖"),
      ],
    );

    const diff = diffGraphData(previous, next);
    assert.deepEqual(diff.addedEdges, ["path-new-relation"]);
    assert.deepEqual(diff.removedEdges, ["legacy-surplus"]);
    assert.deepEqual(diff.migrationWarnings, [{
      code: "legacy_semantic_edge_duplicate",
      semantic_key: JSON.stringify(["wiki/entities/alpha.md", "wiki/topics/beta.md", "依赖"]),
      previous_edge_ids: ["legacy-first", "legacy-surplus"],
      next_edge_ids: ["path-match"],
    }]);
  });

  it("keeps edge direction in identity and ignores confidence changes", () => {
    const previous = graph(
      [
        node("alpha", "wiki/entities/alpha.md", "legacy"),
        node("beta", "wiki/topics/beta.md", "legacy"),
      ],
      [
        edge("legacy-forward", "alpha", "beta", "依赖", "UNVERIFIED"),
        edge("legacy-reverse", "beta", "alpha", "依赖", "EXTRACTED"),
      ],
    );
    const next = graph(
      [
        node("wiki/entities/alpha.md", "wiki/entities/alpha.md", "current"),
        node("wiki/topics/beta.md", "wiki/topics/beta.md", "current"),
      ],
      [
        edge("path-reverse", "wiki/topics/beta.md", "wiki/entities/alpha.md", "依赖", "AMBIGUOUS"),
        edge("path-forward", "wiki/entities/alpha.md", "wiki/topics/beta.md", "依赖", "INFERRED"),
      ],
    );

    const diff = diffGraphData(previous, next);
    assert.deepEqual(diff.addedEdges, []);
    assert.deepEqual(diff.removedEdges, []);
    assert.deepEqual(diff.migrationWarnings, []);
  });

  it("does not match edges through a legacy node that lost an exact-id fallback", () => {
    const previous = graph(
      [
        node("next-id", "wiki/entities/removed.md", "legacy"),
        node("legacy-owner", "wiki/entities/retained.md", "legacy"),
        node("anchor", "wiki/entities/anchor.md", "legacy"),
      ],
      [edge("legacy-edge", "next-id", "anchor")],
    );
    const next = graph(
      [
        node("next-id", "wiki/entities/retained.md", "current"),
        node("anchor", "wiki/entities/anchor.md", "current"),
      ],
      [edge("path-edge", "next-id", "anchor")],
    );

    const alignment = alignGraphIdentityBySourcePath(previous, next);
    assert.deepEqual(Array.from(alignment.previousToNext.entries()), [
      ["legacy-owner", "next-id"],
      ["anchor", "anchor"],
    ]);

    const diff = diffGraphData(previous, next);
    assert.deepEqual(diff.removedNodes, ["next-id"]);
    assert.deepEqual(diff.addedEdges, ["path-edge"]);
    assert.deepEqual(diff.removedEdges, ["legacy-edge"]);
  });
});

function graph(nodes: GraphNode[], edges: GraphEdge[] = []): GraphData {
  return {
    meta: {
      build_date: "2026-07-20T00:00:00.000Z",
      wiki_title: "Path identity migration",
      total_nodes: nodes.length,
      total_edges: edges.length,
    },
    nodes,
    edges,
  };
}

function node(id: string, sourcePath: string | undefined, community: string): GraphNode {
  return {
    id,
    label: id,
    type: "entity",
    ...(sourcePath == null ? {} : { source_path: sourcePath }),
    community,
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  relationType?: string,
  confidence?: GraphEdge["confidence"],
): GraphEdge {
  return {
    id,
    from,
    to,
    type: confidence ?? "EXTRACTED",
    ...(confidence ? { confidence } : {}),
    ...(relationType ? { relation_type: relationType } : {}),
  };
}
