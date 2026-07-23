"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const { scanKnowledgeBaseLinks } = require("../../scripts/lib/wiki-link-index");

describe("shared wikilink scan scale", () => {
  it("uses one inventory, one target index, one source parse, and compact candidate sets", async () => {
    const kbRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "wiki-link-performance-"));
    try {
      await fsp.mkdir(path.join(kbRoot, "wiki/topics"), { recursive: true });
      for (let index = 0; index < 20; index += 1) {
        const directory = path.join(kbRoot, "wiki/entities", `candidate-${String(index).padStart(2, "0")}`);
        await fsp.mkdir(directory, { recursive: true });
        await fsp.writeFile(path.join(directory, "foo.md"), `# Foo ${index}\n`);
      }
      await fsp.writeFile(
        path.join(kbRoot, "wiki/topics/links.md"),
        `# Links\n\n${Array.from({ length: 400 }, () => "[[foo]]").join("\n")}\n`
      );
      await fsp.writeFile(path.join(kbRoot, "index.md"), "# Index\n");

      const result = scanKnowledgeBaseLinks(kbRoot, "graph");
      assert.equal(result.metrics.inventory_walks, 1);
      assert.equal(result.metrics.target_index_builds, 1);
      assert.equal(result.metrics.source_files_parsed, result.inventory.graphSources.length);
      assert.equal(result.candidate_sets.length, 1);
      assert.equal(result.groups.length, 1);
      assert.equal(result.groups[0].occurrences.length, 400);
      assert.equal(JSON.stringify(result.groups).includes(result.candidate_sets[0].candidates[0]), false);
      const serializedBytes = Buffer.byteLength(JSON.stringify(result));
      assert.ok(serializedBytes < 400 * 700 + 20 * 300, `serialized scan was ${serializedBytes} bytes`);
      assert.equal(result.source_documents.length, result.inventory.graphSources.length);
      assert.equal(result.source_documents.every((item) => !path.isAbsolute(item.source_path)), true);
      assert.equal(fs.existsSync(path.join(kbRoot, "wiki/graph-data.json")), false);
    } finally {
      await fsp.rm(kbRoot, { recursive: true, force: true });
    }
  });
});
