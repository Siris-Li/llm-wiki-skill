import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";

import * as graphEngine from "../src";

interface SupportedExportsBaseline {
  workbenchServer: string[];
  workbenchWeb: string[];
  offlineHost: string[];
  supportedPublicCompatibility: string[];
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const BASELINE_PATH = path.join(import.meta.dirname, "fixtures/issue-159/supported-exports.json");

describe("issue #159 supported graph-engine exports", () => {
  it("records the exact exports imported by both workbench packages", async () => {
    const baseline = await readBaseline();

    assert.deepEqual(await packageImports(path.join(REPO_ROOT, "workbench/server/src")), baseline.workbenchServer);
    assert.deepEqual(await packageImports(path.join(REPO_ROOT, "workbench/web/src")), baseline.workbenchWeb);
  });

  it("records the exact graph-engine globals used by the offline host", async () => {
    const baseline = await readBaseline();
    const source = await readFile(path.join(REPO_ROOT, "scripts/build-graph-html.sh"), "utf8");
    const used = [...source.matchAll(/window\.LlmWikiGraphEngine\.([A-Za-z0-9_]+)/g)]
      .map((match) => match[1])
      .filter((name, index, names) => names.indexOf(name) === index)
      .sort();

    assert.deepEqual(used, baseline.offlineHost);
  });

  it("keeps the supported runtime compatibility exports present", async () => {
    const baseline = await readBaseline();
    for (const name of baseline.supportedPublicCompatibility) {
      assert.equal(typeof (graphEngine as Record<string, unknown>)[name], "function", `${name} must remain exported`);
    }
    assert.equal(graphEngine.createGraphRenderer, graphEngine.createStaticGraphRenderer);
  });
});

async function readBaseline(): Promise<SupportedExportsBaseline> {
  return JSON.parse(await readFile(BASELINE_PATH, "utf8")) as SupportedExportsBaseline;
}

async function packageImports(root: string): Promise<string[]> {
  const names = new Set<string>();
  for (const file of await sourceFiles(root)) {
    const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== "@llm-wiki/graph-engine"
      ) continue;
      const clause = statement.importClause;
      if (clause?.name) names.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) names.add((element.propertyName ?? element.name).text);
      }
    }
  }
  return [...names].sort();
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(absolute);
    }
  };
  await visit(root);
  return files.sort();
}
