import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hoverSummaryEntries,
  sanitizeTrialResult
} from "./capture-issue-159-hover-baseline.mjs";

describe("issue 159 hover baseline capture", () => {
  it("removes local artifact directories and paths", () => {
    const sanitized = sanitizeTrialResult({
      artifact_dir: "/tmp/private-run",
      records: [{ action: "hover_preview", artifact_path: "/tmp/private-run/result.json" }]
    });

    assert.equal("artifact_dir" in sanitized, false);
    assert.equal("artifact_path" in sanitized.records[0], false);
  });

  it("summarizes exactly three runs for every prescribed input", () => {
    const production = [1, 2, 3].map((duration) => runArtifact("nodes-1000-sparse", duration));
    const isolated = [1, 2, 3].map((offset) => ({
      records: [
        hoverRecord("nodes-1000-sparse", 10 + offset),
        hoverRecord("nodes-5000-sparse", 20 + offset),
        hoverRecord("nodes-10000-aggregation", 30 + offset)
      ]
    }));

    const entries = hoverSummaryEntries({ production, isolated });
    assert.deepEqual(entries, [
      {
        renderer: "sigma-global-production",
        graph_shape: "nodes-1000-sparse",
        durations_ms: [1, 2, 3],
        median_ms: 2
      },
      {
        renderer: "sigma-graphology-webgl-trial",
        graph_shape: "nodes-1000-sparse",
        durations_ms: [11, 12, 13],
        median_ms: 12
      },
      {
        renderer: "sigma-graphology-webgl-trial",
        graph_shape: "nodes-5000-sparse",
        durations_ms: [21, 22, 23],
        median_ms: 22
      },
      {
        renderer: "sigma-graphology-webgl-trial",
        graph_shape: "nodes-10000-aggregation",
        durations_ms: [31, 32, 33],
        median_ms: 32
      }
    ]);
  });
});

function runArtifact(shape: string, duration: number) {
  return { records: [hoverRecord(shape, duration)] };
}

function hoverRecord(graphShape: string, duration: number) {
  return {
    graph_shape: graphShape,
    action: "hover_preview",
    duration_ms: duration,
    pass: true,
    failure_class: null,
    hover_target_id: "node-a",
    hover_observed_target_id: "node-a",
    hover_preview_state: "visible"
  };
}
