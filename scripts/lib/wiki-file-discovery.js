#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const GRAPH_PAGE_TYPES = Object.freeze({
  entities: "entity",
  topics: "topic",
  sources: "source",
  comparisons: "comparison",
  synthesis: "synthesis",
  queries: "query"
});

const ROOT_EDITABLE_MARKDOWN = new Set(["index.md", "log.md", "purpose.md"]);
const EXCLUDED_DIRECTORY_NAMES = new Set([".obsidian", ".git", ".wiki-tmp", "node_modules"]);
const EXCLUDED_BASENAMES = new Set(["graph-data.json", "graph-warnings.json"]);

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function normalizeRelativePosixPath(pathValue) {
  const value = String(pathValue || "").replaceAll("\\", "/");
  if (!value) {
    throw new Error("Path must not be empty");
  }
  if (value.startsWith("/")) {
    throw new Error("Path must be relative");
  }

  const normalized = path.posix.normalize(value);
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("/../")
  ) {
    throw new Error("Path escapes knowledge-base root");
  }

  return normalized.replace(/^\.\//, "");
}

function isWithinRoot(rootRealPath, candidateAbsolutePath) {
  return candidateAbsolutePath === rootRealPath || candidateAbsolutePath.startsWith(`${rootRealPath}${path.sep}`);
}

function resolveInsideKnowledgeBase(kbRoot, relativePath) {
  const rootRealPath = fs.realpathSync.native(kbRoot);
  const normalized = normalizeRelativePosixPath(relativePath);
  const absolutePath = path.resolve(rootRealPath, ...normalized.split("/"));

  if (!isWithinRoot(rootRealPath, absolutePath)) {
    throw new Error(`Path escapes knowledge-base root: ${relativePath}`);
  }

  return absolutePath;
}

function isGeneratedArtifact(relativePath) {
  const basename = path.posix.basename(relativePath);
  if (EXCLUDED_BASENAMES.has(basename)) return true;
  return /^knowledge-graph(?:[^/]*)\.html$/i.test(basename);
}

function isRenameStagingFile(relativePath) {
  return path.posix.basename(relativePath).startsWith(".llm-wiki-rename-");
}

function isMarkdown(relativePath) {
  return relativePath.toLowerCase().endsWith(".md");
}

function isAttachment(relativePath) {
  return !isMarkdown(relativePath);
}

function graphTypeFor(relativePath) {
  const parts = relativePath.split("/");
  return parts[0] === "wiki" ? (GRAPH_PAGE_TYPES[parts[1]] || null) : null;
}

function isGraphSource(relativePath) {
  return isMarkdown(relativePath) && graphTypeFor(relativePath) !== null;
}

function isLintSource(relativePath) {
  return relativePath === "index.md" || (relativePath.startsWith("wiki/") && isMarkdown(relativePath));
}

function isRenameEditableSource(relativePath) {
  return ROOT_EDITABLE_MARKDOWN.has(relativePath) || (relativePath.startsWith("wiki/") && isMarkdown(relativePath));
}

function isRenameReadOnlySource(relativePath) {
  return isMarkdown(relativePath) && !isRenameEditableSource(relativePath);
}

function fileSetSignature(items) {
  return sha256(items.map((item) => `${item.path}\0${item.kind}\0${item.size}\0${item.mtimeNs}`).join("\n"));
}

function fileKindFor(relativePath) {
  return isMarkdown(relativePath) ? "markdown" : "attachment";
}

function walkKnowledgeBase(rootRealPath, directoryAbsolutePath, results) {
  const entries = fs.readdirSync(directoryAbsolutePath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    const absolutePath = path.join(directoryAbsolutePath, entry.name);
    const relativePath = path.relative(rootRealPath, absolutePath).split(path.sep).join("/");
    const topLevelName = relativePath.split("/")[0];

    if (entry.isDirectory()) {
      if (
        entry.name.startsWith(".")
        || EXCLUDED_DIRECTORY_NAMES.has(entry.name)
        || EXCLUDED_DIRECTORY_NAMES.has(topLevelName)
      ) {
        continue;
      }
      if (entry.isSymbolicLink && entry.isSymbolicLink()) {
        continue;
      }
      const resolvedDirectoryPath = fs.realpathSync.native(absolutePath);
      if (!isWithinRoot(rootRealPath, resolvedDirectoryPath)) {
        continue;
      }
      walkKnowledgeBase(rootRealPath, absolutePath, results);
      continue;
    }

    if (entry.isSymbolicLink && entry.isSymbolicLink()) {
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (EXCLUDED_DIRECTORY_NAMES.has(topLevelName)) {
      continue;
    }

    const normalizedPath = normalizeRelativePosixPath(relativePath);
    if (entry.name.startsWith(".") && normalizedPath !== ".wiki-schema.md") {
      continue;
    }
    if (isGeneratedArtifact(normalizedPath) || isRenameStagingFile(normalizedPath)) {
      continue;
    }
    if (!isMarkdown(normalizedPath) && !isAttachment(normalizedPath)) {
      continue;
    }

    const resolvedFilePath = fs.realpathSync.native(absolutePath);
    if (!isWithinRoot(rootRealPath, resolvedFilePath)) {
      continue;
    }

    const stat = fs.statSync(absolutePath, { bigint: true });
    results.push({
      path: normalizedPath,
      absolutePath,
      kind: fileKindFor(normalizedPath),
      editable: isRenameEditableSource(normalizedPath),
      graphType: graphTypeFor(normalizedPath),
      size: Number(stat.size),
      mtimeNs: String(stat.mtimeNs)
    });
  }
}

function discoverKnowledgeBaseFiles(kbRoot) {
  const rootRealPath = fs.realpathSync.native(kbRoot);
  const inventory = [];
  walkKnowledgeBase(rootRealPath, rootRealPath, inventory);
  inventory.sort((left, right) => left.path.localeCompare(right.path, "en"));

  const graphSources = inventory.filter((item) => item.kind === "markdown" && isGraphSource(item.path));
  const lintSources = inventory.filter((item) => item.kind === "markdown" && isLintSource(item.path));
  const renameEditableSources = inventory.filter((item) => item.kind === "markdown" && isRenameEditableSource(item.path));
  const renameReadOnlySources = inventory.filter((item) => item.kind === "markdown" && isRenameReadOnlySource(item.path));
  const targets = inventory.map(({ size, mtimeNs, ...item }) => item);

  return {
    graphSources,
    lintSources,
    renameEditableSources,
    renameReadOnlySources,
    targets,
    fileSetSha256: fileSetSignature(inventory)
  };
}

module.exports = {
  GRAPH_PAGE_TYPES,
  discoverKnowledgeBaseFiles,
  normalizeRelativePosixPath,
  resolveInsideKnowledgeBase
};
