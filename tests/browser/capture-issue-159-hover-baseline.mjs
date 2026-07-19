#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ISSUE_159_HOVER_FORMULA,
  medianOfThree
} from "./compare-issue-159-hover-baseline.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const immutableBaselineDir = path.join(repoRoot, "docs/graph/performance/artifacts/issue-159/baseline");
const productionShapes = ["nodes-1000-sparse"];
const isolatedShapes = ["nodes-1000-sparse", "nodes-5000-sparse", "nodes-10000-aggregation"];
const runsPerInput = 3;
const buildMethod = "npm run build -w @llm-wiki/graph-engine; node --import tsx; Playwright Chromium headless";

export function sanitizeTrialResult(input) {
  const result = structuredClone(input);
  delete result.artifact_dir;
  for (const record of result.records || []) delete record.artifact_path;
  return result;
}

export function hoverSummaryEntries(runResults) {
  const definitions = [
    { renderer: "sigma-global-production", shapes: productionShapes, runs: runResults.production },
    { renderer: "sigma-graphology-webgl-trial", shapes: isolatedShapes, runs: runResults.isolated }
  ];
  const entries = [];
  for (const definition of definitions) {
    if (!Array.isArray(definition.runs) || definition.runs.length !== runsPerInput) {
      throw new Error(`${definition.renderer}: expected exactly three run artifacts`);
    }
    for (const graphShape of definition.shapes) {
      const durations = definition.runs.map((run, index) => {
        const record = (run.records || []).find((item) => item.graph_shape === graphShape && item.action === "hover_preview");
        if (!record) throw new Error(`${definition.renderer}/${graphShape}: run ${index + 1} missing hover_preview`);
        if (record.pass !== true || record.failure_class || record.hover_preview_state !== "visible") {
          throw new Error(`${definition.renderer}/${graphShape}: run ${index + 1} hover_preview did not pass`);
        }
        if (!record.hover_target_id || record.hover_observed_target_id !== record.hover_target_id) {
          throw new Error(`${definition.renderer}/${graphShape}: run ${index + 1} hover target mismatch`);
        }
        return record.duration_ms;
      });
      entries.push({
        renderer: definition.renderer,
        graph_shape: graphShape,
        durations_ms: durations,
        median_ms: medianOfThree(durations)
      });
    }
  }
  return entries;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(args.output || immutableBaselineDir);
  if (outputDir === immutableBaselineDir && args.mode !== "baseline") {
    throw new Error("the immutable baseline directory cannot be used for candidate results");
  }
  if (args.mode === "baseline" && outputDir !== immutableBaselineDir) {
    throw new Error(`baseline mode writes only to ${path.relative(repoRoot, immutableBaselineDir)}`);
  }
  if (fs.existsSync(outputDir)) {
    throw new Error(`refusing to overwrite existing hover results: ${path.relative(repoRoot, outputDir) || outputDir}`);
  }

  const testedCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  run("npm", ["run", "build", "-w", "@llm-wiki/graph-engine"]);

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-issue-159-hover-capture-"));
  const production = [];
  const isolated = [];
  try {
    for (let index = 1; index <= runsPerInput; index += 1) {
      const productionRawDir = path.join(stagingDir, `raw-production-${index}`);
      const isolatedRawDir = path.join(stagingDir, `raw-isolated-${index}`);
      fs.mkdirSync(productionRawDir);
      fs.mkdirSync(isolatedRawDir);

      run(process.execPath, ["--import", "tsx", "tests/browser/graph-sigma-global-production.ts"], {
        GRAPH_SIGMA_PRODUCTION_SHAPES: productionShapes.join(","),
        GRAPH_SIGMA_PRODUCTION_ACTIONS: "hover_preview",
        GRAPH_SIGMA_PRODUCTION_ARTIFACT_DIR: productionRawDir
      });
      run(process.execPath, ["--import", "tsx", "tests/browser/graph-sigma-graphology-trial.ts"], {
        GRAPH_SIGMA_TRIAL_SHAPES: isolatedShapes.join(","),
        GRAPH_SIGMA_TRIAL_ACTIONS: "hover_preview",
        GRAPH_SIGMA_TRIAL_ARTIFACT_DIR: isolatedRawDir
      });

      production.push(readSuccessfulResult(path.join(productionRawDir, "sigma-global-production-results.json")));
      isolated.push(readSuccessfulResult(path.join(isolatedRawDir, "sigma-graphology-trial-results.json")));
    }

    const allResults = [...production, ...isolated];
    const browserVersions = [...new Set(allResults.map((result) => result.browser))];
    if (browserVersions.length !== 1 || !browserVersions[0]) {
      throw new Error(`browser version changed across runs: ${browserVersions.join(",") || "missing"}`);
    }
    const entries = hoverSummaryEntries({ production, isolated });
    const summary = {
      schema_version: "1.0.0",
      issue: 159,
      captured_by_issue: 272,
      result_kind: args.mode,
      immutable: args.mode === "baseline",
      source_implementation: "pre-migration graph implementation",
      tested_commit: testedCommit,
      browser_version: browserVersions[0],
      build_method: buildMethod,
      environment: {
        os: `${process.platform}-${process.arch}`,
        node: process.version,
        browser: browserVersions[0]
      },
      runs_per_input: runsPerInput,
      formula: ISSUE_159_HOVER_FORMULA,
      entries
    };

    const finalStagingDir = path.join(stagingDir, "sanitized-results");
    fs.mkdirSync(finalStagingDir);
    production.forEach((result, index) => writeJson(path.join(finalStagingDir, `production-run-${index + 1}.json`), result));
    isolated.forEach((result, index) => writeJson(path.join(finalStagingDir, `isolated-run-${index + 1}.json`), result));
    writeJson(path.join(finalStagingDir, "hover-medians.json"), summary);
    assertNoPrivatePaths(finalStagingDir);
    fs.mkdirSync(path.dirname(outputDir), { recursive: true });
    fs.renameSync(finalStagingDir, outputDir);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function readSuccessfulResult(file) {
  const result = sanitizeTrialResult(JSON.parse(fs.readFileSync(file, "utf8")));
  const failures = (result.records || []).filter((record) => record.pass !== true || record.failure_class);
  if ((result.errors || []).length || failures.length) {
    throw new Error(`${path.basename(file)} contains failed trial records`);
  }
  return result;
}

function run(command, args, extraEnvironment = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnvironment },
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

function parseArgs(args) {
  const parsed = { mode: "baseline", output: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--mode") parsed.mode = args[++index];
    else if (args[index] === "--output") parsed.output = args[++index];
    else throw new Error(`unknown argument: ${args[index]}`);
  }
  if (!new Set(["baseline", "candidate"]).has(parsed.mode)) throw new Error(`invalid mode: ${parsed.mode}`);
  if (parsed.mode === "candidate" && !parsed.output) throw new Error("candidate mode requires --output");
  return parsed;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function assertNoPrivatePaths(directory) {
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const text = fs.readFileSync(path.join(directory, file), "utf8");
    if (/(?:\/Users\/|\/home\/|\/private\/var\/|\/tmp\/|[A-Za-z]:\\\\)/.test(text)) {
      throw new Error(`${file} contains an absolute local path`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
