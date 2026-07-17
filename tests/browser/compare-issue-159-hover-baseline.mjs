#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const ISSUE_159_HOVER_FORMULA = "afterMedian <= beforeMedian + max(beforeMedian * 0.20, 50ms)";

export function medianOfThree(values) {
  if (!Array.isArray(values) || values.length !== 3) {
    throw new Error(`hover median requires exactly three runs; received=${Array.isArray(values) ? values.length : "not-an-array"}`);
  }
  const numbers = values.map((value) => Number(value));
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`hover durations must be finite non-negative numbers; values=${JSON.stringify(values)}`);
  }
  return [...numbers].sort((left, right) => left - right)[1];
}

export function allowedAfterMedian(beforeMedian) {
  const before = Number(beforeMedian);
  if (!Number.isFinite(before) || before < 0) throw new Error(`invalid before median: ${beforeMedian}`);
  return before + Math.max(before * 0.20, 50);
}

export function compareHoverMedians(baselineEntries, candidateEntries) {
  const baseline = indexEntries(baselineEntries, "baseline");
  const candidate = indexEntries(candidateEntries, "candidate");
  const missing = [...baseline.keys()].filter((key) => !candidate.has(key));
  const unexpected = [...candidate.keys()].filter((key) => !baseline.has(key));
  if (missing.length || unexpected.length) {
    throw new Error(`hover comparison inputs differ; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`);
  }

  return [...baseline.entries()].map(([key, before]) => {
    const after = candidate.get(key);
    const beforeMedian = Number(before.median_ms);
    const afterMedian = Number(after.median_ms);
    if (!Number.isFinite(beforeMedian) || !Number.isFinite(afterMedian)) {
      throw new Error(`${key}: median_ms must be finite`);
    }
    const limit = allowedAfterMedian(beforeMedian);
    return {
      renderer: before.renderer,
      graph_shape: before.graph_shape,
      before_median_ms: beforeMedian,
      after_median_ms: afterMedian,
      limit_ms: limit,
      pass: afterMedian <= limit,
      formula: ISSUE_159_HOVER_FORMULA
    };
  });
}

function indexEntries(entries, label) {
  if (!Array.isArray(entries)) throw new Error(`${label}.entries must be an array`);
  const index = new Map();
  for (const entry of entries) {
    const key = `${entry?.renderer || ""}/${entry?.graph_shape || ""}`;
    if (!entry?.renderer || !entry?.graph_shape) throw new Error(`${label}: renderer and graph_shape are required`);
    if (index.has(key)) throw new Error(`${label}: duplicate entry ${key}`);
    index.set(key, entry);
  }
  return index;
}

function compareManifests(baseline, candidate) {
  if (baseline.formula !== ISSUE_159_HOVER_FORMULA) {
    throw new Error(`baseline formula changed; expected=${ISSUE_159_HOVER_FORMULA}; actual=${baseline.formula || "missing"}`);
  }
  if (baseline.runs_per_input !== 3 || candidate.runs_per_input !== 3) {
    throw new Error("baseline and candidate must each contain exactly three runs per input");
  }
  if (baseline.build_method !== candidate.build_method) {
    throw new Error(`build method mismatch; before=${baseline.build_method}; after=${candidate.build_method}`);
  }
  if (baseline.browser_version !== candidate.browser_version) {
    throw new Error(`browser version mismatch; before=${baseline.browser_version}; after=${candidate.browser_version}`);
  }
  return compareHoverMedians(baseline.entries, candidate.entries);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    console.error("Usage: compare-issue-159-hover-baseline.mjs <baseline-summary.json> <candidate-summary.json>");
    process.exit(2);
  }
  try {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
    const results = compareManifests(baseline, candidate);
    console.log(JSON.stringify({ formula: ISSUE_159_HOVER_FORMULA, results }, null, 2));
    if (results.some((result) => !result.pass)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
