import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("offline graph storage namespace compatibility", () => {
  it("keeps the exact existing Pin and theme keys in the current offline host", async () => {
    const source = await readFile(path.join(REPO_ROOT, "scripts/build-graph-html.sh"), "utf8");
    const script = extractStorageNamespaceSource(source);
    const storageNamespace = evaluateStorageNamespace(script);
    const namespace = storageNamespace({ wiki_title: "AI知识图谱Demo" }, "/wiki/graph.html");

    assert.equal(namespace, "llm-wiki:ai知识图谱demo:11cnyt7");
    assert.equal(`${namespace}:graph-pins`, "llm-wiki:ai知识图谱demo:11cnyt7:graph-pins");
    assert.equal(`${namespace}:graph-theme`, "llm-wiki:ai知识图谱demo:11cnyt7:graph-theme");
  });
});

function extractStorageNamespaceSource(source: string): string {
  const start = source.indexOf("function normalizeStorageSegment");
  const end = source.indexOf("function readStoredPins", start);
  assert.ok(start >= 0 && end > start, "offline storage namespace implementation should remain in the current host");
  return source.slice(start, end);
}

function evaluateStorageNamespace(script: string): (meta: { wiki_title?: string }, pathname: string) => string {
  return Function(`${script}\nreturn storageNamespace;`)() as (
    meta: { wiki_title?: string },
    pathname: string
  ) => string;
}
