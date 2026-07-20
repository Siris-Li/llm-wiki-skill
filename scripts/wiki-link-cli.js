#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { scanKnowledgeBaseLinks, validatePortableMarkdownFilename } = require("./lib/wiki-link-index");
const { renderWikilinkReplacement } = require("./lib/wikilink-parser");

function usage() {
  return [
    "Usage:",
    "  node scripts/wiki-link-cli.js graph <kb-root> <output-dir> [--test-mode]",
    "  node scripts/wiki-link-cli.js check <kb-root> [--strict] [--json]",
    "  node scripts/wiki-link-cli.js rename-scan <kb-root> <source-path> <new-name>"
  ].join("\n");
}

function sanitizeEntries(entries) {
  return entries.map((item) => ({
    path: item.path,
    kind: item.kind,
    editable: item.editable,
    graphType: item.graphType
  }));
}

function sanitizeInventory(inventory) {
  return {
    graphSources: sanitizeEntries(inventory.graphSources),
    lintSources: sanitizeEntries(inventory.lintSources),
    renameEditableSources: sanitizeEntries(inventory.renameEditableSources),
    renameReadOnlySources: sanitizeEntries(inventory.renameReadOnlySources),
    targets: sanitizeEntries(inventory.targets),
    fileSetSha256: inventory.fileSetSha256
  };
}

function hasStrictErrors(report) {
  return report.groups.some((group) => group.severity === "error");
}

function buildCheckReport(kbRoot, policy) {
  const scan = scanKnowledgeBaseLinks(kbRoot, policy);
  return {
    policy,
    inventory: sanitizeInventory(scan.inventory),
    edges: scan.edges,
    candidate_sets: scan.candidate_sets,
    groups: scan.groups,
    stale_pending_wrappers: scan.stale_pending_wrappers,
    metrics: scan.metrics
  };
}

function basenameWithoutMarkdown(relativePath) {
  return path.posix.basename(relativePath, ".md");
}

function replacementTargetForOccurrence(occurrence, targetPath) {
  if (occurrence.link_kind === "attachment_wikilink") {
    return targetPath;
  }
  if (!occurrence.page_target.includes("/") && !occurrence.page_target.endsWith(".md")) {
    return basenameWithoutMarkdown(targetPath);
  }
  return targetPath;
}

function buildRenameScanReport(kbRoot, sourcePath, newName) {
  const scan = scanKnowledgeBaseLinks(kbRoot, "rename");
  const sourceEntry = scan.inventory.graphSources.find((item) => item.path === sourcePath);
  if (!sourceEntry) {
    throw new Error(`Source is not a formal graph page: ${sourcePath}`);
  }

  const validation = validatePortableMarkdownFilename(sourcePath, newName, scan.inventory.targets);
  if (!validation.ok) {
    throw new Error(`Invalid target name (${validation.reason}): ${newName}`);
  }

  const renameTargetPath = validation.target_path;
  const editable = [];
  const readOnly = [];
  const ambiguous = [];

  for (const occurrence of scan.occurrences) {
    const destination = occurrence.read_only ? readOnly : editable;
    const resolution = occurrence.resolution;

    if (resolution.status === "resolved" && resolution.target_path === sourcePath) {
      destination.push({
        source_path: occurrence.source_path,
        file_sha256: occurrence.file_sha256,
        start_byte: occurrence.start_byte,
        end_byte: occurrence.end_byte,
        raw_link: occurrence.raw_link,
        replacement: renderWikilinkReplacement(
          occurrence,
          replacementTargetForOccurrence(occurrence, renameTargetPath)
        )
      });
      continue;
    }

    if (resolution.status === "ambiguous" && resolution.candidate_paths.includes(sourcePath)) {
      const rendered_candidates = resolution.candidate_paths.map((candidatePath) => ({
        candidate_path: candidatePath,
        replacement: renderWikilinkReplacement(
          occurrence,
          candidatePath === sourcePath
            ? replacementTargetForOccurrence(occurrence, renameTargetPath)
            : candidatePath
        )
      }));
      ambiguous.push({
        source_path: occurrence.source_path,
        file_sha256: occurrence.file_sha256,
        start_byte: occurrence.start_byte,
        end_byte: occurrence.end_byte,
        raw_link: occurrence.raw_link,
        candidate_paths: resolution.candidate_paths,
        rendered_candidates
      });
    }
  }

  return {
    file_set_sha256: scan.inventory.fileSetSha256,
    source_path: sourcePath,
    target_path: renameTargetPath,
    validation,
    editable_occurrences: editable,
    read_only_occurrences: readOnly,
    ambiguous_occurrences: ambiguous,
    metrics: scan.metrics
  };
}

function main(argv) {
  const [command, ...rest] = argv;

  if (!command) {
    console.error(usage());
    return 1;
  }

  try {
    if (command === "graph") {
      const [kbRoot, outputDir] = rest;
      if (!kbRoot || !outputDir) {
        throw new Error("graph requires <kb-root> and <output-dir>");
      }

      const report = buildCheckReport(kbRoot, "graph");
      process.stdout.write(`${JSON.stringify({ output_dir: outputDir, report }, null, 2)}\n`);
      return 0;
    }

    if (command === "check") {
      const [kbRoot, ...flags] = rest;
      if (!kbRoot) {
        throw new Error("check requires <kb-root>");
      }
      const strict = flags.includes("--strict");
      const report = buildCheckReport(kbRoot, "lint");

      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return strict && hasStrictErrors(report) ? 2 : 0;
    }

    if (command === "rename-scan") {
      const [kbRoot, sourcePath, newName] = rest;
      if (!kbRoot || !sourcePath || !newName) {
        throw new Error("rename-scan requires <kb-root> <source-path> <new-name>");
      }

      const report = buildRenameScanReport(kbRoot, sourcePath, newName);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
