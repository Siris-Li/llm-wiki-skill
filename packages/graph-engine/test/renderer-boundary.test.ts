import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

const HOST_CALLBACK_IDENTIFIERS = [
  "onOpenPage",
  "onSelectionChange",
  "onSelectionClear",
  "onAsk",
  "persistPins",
  "onDragStateChange",
  "GraphEngineCapabilities",
  "GraphOpenPagePayload"
];

const HOST_CALLBACK_ALLOWED_FILES = new Set(["facade.ts", "types.ts"]);

describe("renderer and facade boundary contract", () => {
  it("keeps host callback names out of layout and renderer modules", async () => {
    const files = await sourceFiles(SRC);
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(SRC, file);
      if (HOST_CALLBACK_ALLOWED_FILES.has(rel)) continue;
      const text = await readFile(file, "utf8");
      for (const identifier of HOST_CALLBACK_IDENTIFIERS) {
        if (new RegExp(`\\b${identifier}\\b`).test(text)) violations.push(`${rel}: ${identifier}`);
      }
    }

    assert.deepEqual(violations, []);
  });

  it("keeps graph object hit classification calls inside GraphGestures", async () => {
    const renderFiles = (await sourceFiles(join(SRC, "render")))
      .filter((file) => {
        const rel = relative(SRC, file);
        return rel !== "render/gestures.ts" && rel !== "render/index.ts";
      });
    const violations: string[] = [];
    const forbiddenCalls = /\bclassifyGraph(?:EventTarget|WheelTarget|WheelTargetFromGraphTarget|PointerDownTarget|PointerDownTargetFromGraphTarget)\s*\(/;

    for (const file of renderFiles) {
      const rel = relative(SRC, file);
      const text = await readFile(file, "utf8");
      if (forbiddenCalls.test(text)) violations.push(rel);
    }

    assert.deepEqual(violations, []);
  });
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  }));
  return files.flat();
}
