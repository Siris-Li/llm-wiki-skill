#!/usr/bin/env node
import fs from "node:fs";

const resultPath = process.argv[2];
if (!resultPath) {
  console.error("Usage: validate-graph-trial-result.mjs <result-json>");
  process.exit(2);
}

const requiredActions = [
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
];

const data = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const records = Array.isArray(data.records) ? data.records : [];
const shapes = Array.isArray(data.shapes) ? data.shapes : [];
const errors = Array.isArray(data.errors) ? data.errors : [];
const failures = [];

for (const error of errors) {
  failures.push(`error: ${error}`);
}

for (const shape of shapes) {
  const shapeRecords = records.filter((record) => record.graph_shape === shape);
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

for (const record of records) {
  if (record.pass === false || record.failure_class) {
    failures.push(`${record.graph_shape}/${record.action}: pass=${record.pass}; failure=${record.failure_class || "none"}; detail=${record.failure_detail || "none"}`);
  }
}

if (failures.length) {
  console.error(`FAIL: graph trial result validation found ${failures.length} issue(s) in ${resultPath}`);
  for (const failure of failures.slice(0, 30)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PASS: graph trial result validation (${records.length} records, ${shapes.length} shapes)`);
