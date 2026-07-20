import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildAtlasModel,
  projectGraphInput,
  type GraphData,
} from "../src";
import { captureSupportedMigrationBehavior } from "./support/migration-baseline";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures/issue-159");

describe("issue #159 migration behavior baseline", () => {
  it("preserves the unrelated reviewed text behavior", async () => {
    const input = JSON.parse(await readFile(path.join(FIXTURE_DIR, "behavior-input.json"), "utf8")) as GraphData;
    const expected = JSON.parse(await readFile(path.join(FIXTURE_DIR, "behavior-baseline.json"), "utf8")) as {
      text: unknown;
    };
    const actual = captureSupportedMigrationBehavior(input) as { text: unknown };

    assert.deepEqual(actual.text, expected.text);
  });

  it("supersedes collision rows with first-wins unique collections and warnings", async () => {
    const input = JSON.parse(await readFile(path.join(FIXTURE_DIR, "behavior-input.json"), "utf8")) as GraphData;
    const projection = projectGraphInput(input);
    const model = buildAtlasModel(input);

    assert.deepEqual(projection.data.nodes.map((node) => node.id), [
      "alpha",
      "duplicate",
      "numeric-label",
      "long-content",
      "node-0",
    ]);
    assert.deepEqual(projection.data.edges.map((edge) => edge.id), [
      "alpha-duplicate",
      "duplicate-alpha",
      "duplicate-edge",
    ]);
    assert.equal(projection.data.nodes.find((node) => node.id === "duplicate")?.source, "wiki/duplicate-first.md");
    assert.equal(model.byId.duplicate?.source_path, "wiki/duplicate-first.md");
    assert.deepEqual(model.communities.map((community) => [community.id, community.label]), [
      ["core", "Core first"],
      ["sources", "Sources"],
      ["_none", "未分组"],
    ]);
    assert.deepEqual(projection.warnings.map((warning) => warning.code), [
      "duplicate_node_id",
      "duplicate_edge_id",
      "duplicate_community_id",
    ]);
    assert.deepEqual(model.warnings, projection.warnings);
  });
});
