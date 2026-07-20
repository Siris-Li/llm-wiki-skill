const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const {
  discoverKnowledgeBaseFiles
} = require("../../scripts/lib/wiki-file-discovery");

const FIXTURE = path.join(__dirname, "..", "fixtures", "graph-path-identity-wiki");
const EXPECTED = JSON.parse(
  fs.readFileSync(path.join(FIXTURE, "expected.json"), "utf8")
);

function copyFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-discovery-"));
}

function cloneFixture(root) {
  fs.cpSync(FIXTURE, root, { recursive: true });
}

function inventoryPaths(items) {
  return items.map((item) => item.path);
}

function flattenInventoryPaths(inventory) {
  return [
    ...inventoryPaths(inventory.graphSources),
    ...inventoryPaths(inventory.lintSources),
    ...inventoryPaths(inventory.renameEditableSources),
    ...inventoryPaths(inventory.renameReadOnlySources),
    ...inventoryPaths(inventory.targets)
  ];
}

describe("discoverKnowledgeBaseFiles", () => {
  it("builds the three policy views from one sorted inventory", () => {
    const inventory = discoverKnowledgeBaseFiles(FIXTURE);

    assert.deepEqual(inventoryPaths(inventory.graphSources), EXPECTED.graphSources);
    assert.deepEqual(inventoryPaths(inventory.lintSources), EXPECTED.lintSources);
    assert.deepEqual(inventoryPaths(inventory.renameEditableSources), EXPECTED.renameEditableSources);
    assert.deepEqual(inventoryPaths(inventory.renameReadOnlySources), EXPECTED.renameReadOnlySources);
    assert.deepEqual(inventoryPaths(inventory.targets), EXPECTED.targets);
    assert.equal(inventory.targets.some((item) => item.path === "raw/assets/Figure.png"), true);
  });

  it("rejects symlink escapes instead of indexing them", () => {
    const tempRoot = copyFixture();
    try {
      cloneFixture(tempRoot);

      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-outside-"));
      fs.writeFileSync(path.join(outsideDir, "outside.md"), "# Outside\n", "utf8");

      const escapeLinkPath = path.join(tempRoot, "wiki", "entities", "escape-dir");
      fs.symlinkSync(
        outsideDir,
        escapeLinkPath,
        process.platform === "win32" ? "junction" : "dir"
      );

      const inventory = discoverKnowledgeBaseFiles(tempRoot);
      const allPaths = flattenInventoryPaths(inventory);
      assert.equal(allPaths.some((item) => item.includes("escape-dir")), false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("excludes generated artifacts, hidden paths, third-party paths, and rename staging files from every view and hash", () => {
    const tempRoot = copyFixture();
    try {
      cloneFixture(tempRoot);
      fs.mkdirSync(path.join(tempRoot, ".obsidian"), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, ".obsidian", "workspace.md"), "# Hidden\n", "utf8");
      fs.mkdirSync(path.join(tempRoot, "sandbox", ".git"), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "sandbox", ".git", "head.md"), "# Git\n", "utf8");
      fs.mkdirSync(path.join(tempRoot, ".wiki-tmp"), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, ".wiki-tmp", "transient.md"), "# Tmp\n", "utf8");
      fs.mkdirSync(path.join(tempRoot, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, "node_modules", "pkg", "doc.md"), "# Module\n", "utf8");
      fs.writeFileSync(path.join(tempRoot, "wiki", ".llm-wiki-rename-stage.md"), "# Stage\n", "utf8");

      const before = discoverKnowledgeBaseFiles(tempRoot);
      const beforePaths = flattenInventoryPaths(before);

      for (const excludedArtifact of EXPECTED.excludedArtifacts) {
        assert.equal(beforePaths.includes(excludedArtifact), false, `${excludedArtifact} should be excluded`);
      }
      for (const excludedPath of [
        ".obsidian/workspace.md",
        "sandbox/.git/head.md",
        ".wiki-tmp/transient.md",
        "node_modules/pkg/doc.md",
        "wiki/.llm-wiki-rename-stage.md"
      ]) {
        assert.equal(beforePaths.includes(excludedPath), false, `${excludedPath} should be excluded`);
      }

      fs.writeFileSync(path.join(tempRoot, "wiki", "graph-data.json"), "{\"mutated\":true}\n", "utf8");
      fs.writeFileSync(path.join(tempRoot, "exports", "graph-data.json"), "{\"mutated\":true}\n", "utf8");
      fs.writeFileSync(path.join(tempRoot, ".obsidian", "workspace.md"), "# Changed\n", "utf8");
      fs.writeFileSync(path.join(tempRoot, "wiki", ".llm-wiki-rename-stage.md"), "# Changed stage\n", "utf8");

      const after = discoverKnowledgeBaseFiles(tempRoot);
      assert.equal(after.fileSetSha256, before.fileSetSha256);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
