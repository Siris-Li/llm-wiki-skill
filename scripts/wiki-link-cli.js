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
        classification: occurrence.read_only ? "read_only" : "editable",
        read_only: occurrence.read_only,
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

function assertExactFlags(flags, allowedFlags) {
  const seen = new Set();
  for (const flag of flags) {
    if (!allowedFlags.has(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (seen.has(flag)) {
      throw new Error(`Duplicate argument: ${flag}`);
    }
    seen.add(flag);
  }
  return seen;
}

function parseArguments(command, rest) {
  if (command === "graph") {
    if (rest.length < 2 || rest.length > 3 || rest[0].startsWith("--") || rest[1].startsWith("--")) {
      throw new Error("graph requires <kb-root> <output-dir> [--test-mode]");
    }
    const flags = assertExactFlags(rest.slice(2), new Set(["--test-mode"]));
    return { kbRoot: rest[0], outputDir: rest[1], testMode: flags.has("--test-mode") };
  }

  if (command === "check") {
    if (rest.length < 1 || rest[0].startsWith("--")) {
      throw new Error("check requires <kb-root> [--strict] [--json]");
    }
    const flags = assertExactFlags(rest.slice(1), new Set(["--strict", "--json"]));
    return { kbRoot: rest[0], strict: flags.has("--strict"), json: flags.has("--json") };
  }

  if (command === "rename-scan") {
    if (rest.length !== 3 || rest.some((value) => value.startsWith("--"))) {
      throw new Error("rename-scan requires <kb-root> <source-path> <new-name>");
    }
    return { kbRoot: rest[0], sourcePath: rest[1], newName: rest[2] };
  }

  throw new Error(`Unknown command: ${command}`);
}

function main(argv) {
  const [command, ...rest] = argv;

  if (!command) {
    console.error(usage());
    return 1;
  }

  try {
    const args = parseArguments(command, rest);
    if (command === "graph") {
      const report = buildCheckReport(args.kbRoot, "graph");
      process.stdout.write(`${JSON.stringify({ output_dir: args.outputDir, report }, null, 2)}\n`);
      return 0;
    }

    if (command === "check") {
      const report = buildCheckReport(args.kbRoot, "lint");

      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return args.strict && hasStrictErrors(report) ? 2 : 0;
    }

    if (command === "rename-scan") {
      const report = buildRenameScanReport(args.kbRoot, args.sourcePath, args.newName);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
