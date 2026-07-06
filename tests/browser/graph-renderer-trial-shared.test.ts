import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DURATION_GATED_ACTIONS,
  durationLimitMs,
  validateTrialResults,
  type TrialRecordLike
} from "./graph-renderer-trial-shared";

describe("graph renderer browser trial gates", () => {
  it("duration-gates return_global_takeover records", () => {
    assert.equal(DURATION_GATED_ACTIONS.has("return_global_takeover"), true);
    assert.equal(durationLimitMs({ nodes: 1000 }, "return_global_takeover") != null, true);

    const record: TrialRecordLike = {
      graph_shape: "shape",
      action: "return_global_takeover",
      pass: true,
      nodes: 1000,
      duration_ms: null,
      failure_class: null,
      schema_version: "1.0.0",
      production_path: true,
      thresholds: {},
      browser: "chromium",
      build_commit: "test",
      run_started_at: "2026-07-06T00:00:00.000Z",
      run_finished_at: "2026-07-06T00:00:01.000Z"
    };

    assert.throws(
      () => validateTrialResults({
        renderer: "sigma-global-production",
        requestedShapes: ["shape"],
        requiredActions: ["return_global_takeover"],
        records: [record],
        errors: [],
        resultPath: "/tmp/result.json"
      }),
      /duration_missing/
    );
  });
});
