import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import {
  type GraphData
} from "../src";
import { captureSupportedMigrationBehavior } from "./support/migration-baseline";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures/issue-159");

describe("issue #159 migration behavior baseline", () => {
  it("matches the manually reviewed legacy implementation output field for field", async () => {
    const input = JSON.parse(await readFile(path.join(FIXTURE_DIR, "behavior-input.json"), "utf8")) as GraphData;
    const expected = JSON.parse(await readFile(path.join(FIXTURE_DIR, "behavior-baseline.json"), "utf8"));

    assert.deepEqual(captureSupportedMigrationBehavior(input), expected);
  });
});
