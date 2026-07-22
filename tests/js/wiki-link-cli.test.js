const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "scripts", "wiki-link-cli.js");
const FIXTURE = path.join(REPO_ROOT, "tests", "fixtures", "graph-path-identity-wiki");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}

describe("wiki-link-cli process contract", () => {
  it("returns 0 for ordinary check and 2 only for strict data errors", () => {
    assert.equal(runCli(["check", FIXTURE, "--json"]).status, 0);
    assert.equal(runCli(["check", FIXTURE, "--strict", "--json"]).status, 2);
  });

  it("returns 1 for invalid arguments and rejects unknown, duplicate, extra, and misplaced values", () => {
    const invalidCases = [
      ["check", FIXTURE, "--unknown"],
      ["check", FIXTURE, "--strict", "--strict"],
      ["check", "--json", FIXTURE],
      ["graph", FIXTURE, "out", "--test-mode", "--test-mode"],
      ["rename-scan", FIXTURE, "wiki/topics/foo.md", "bar.md", "extra"]
    ];

    for (const args of invalidCases) {
      const result = runCli(args);
      assert.equal(result.status, 1, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    }
  });

  it("returns 1 for a real tool failure", () => {
    const missingRoot = path.join(os.tmpdir(), `missing-wiki-${process.pid}-${Date.now()}`);
    assert.equal(runCli(["check", missingRoot, "--json"]).status, 1);
  });

  it("does not embed an absolute details path when warning verification fails", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-warning-embed-"));
    try {
      fs.mkdirSync(path.join(tempRoot, "wiki"), { recursive: true });
      const graphPath = path.join(tempRoot, "wiki", "graph-data.json");
      const outputPath = path.join(tempRoot, "warning-data.json");
      const absoluteDetailsPath = "/Users/private/secret/graph-warnings.json";
      fs.writeFileSync(graphPath, JSON.stringify({
        meta: {
          warning_summary: {
            build_id: "a".repeat(64),
            total_groups: 0,
            total_occurrences: 0,
            error_occurrences: 0,
            warning_occurrences: 0,
            by_code: {},
            details_ref: absoluteDetailsPath,
            details_sha256: "b".repeat(64)
          }
        },
        nodes: [],
        edges: []
      }), "utf8");

      const result = runCli([
        "warning-embed",
        tempRoot,
        graphPath,
        path.join(tempRoot, "wiki", "graph-warnings.json"),
        outputPath
      ]);
      assert.equal(result.status, 0, result.stderr);
      const output = fs.readFileSync(outputPath, "utf8");
      assert.equal(output.includes(absoluteDetailsPath), false);
      assert.equal(Object.hasOwn(JSON.parse(output).summary, "details_ref"), false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps editable and read-only ambiguity classifications in rename output", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-cli-"));
    try {
      fs.cpSync(FIXTURE, tempRoot, { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "raw", "notes", "references.md"), "[[foo]]\n", "utf8");

      const result = runCli([
        "rename-scan",
        tempRoot,
        "wiki/topics/foo.md",
        "foo-renamed.md"
      ]);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      const classes = new Set(report.ambiguous_occurrences.map((item) => item.classification));
      assert.deepEqual(classes, new Set(["editable", "read_only"]));
      assert.equal(
        report.ambiguous_occurrences.find((item) => item.source_path === "raw/notes/references.md").read_only,
        true
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
