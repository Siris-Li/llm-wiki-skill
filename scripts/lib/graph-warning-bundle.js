#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { normalizeRelativePosixPath } = require("./wiki-file-discovery");

const DEFAULT_WARNING_DETAILS_REF = "wiki/graph-warnings.json";
const OFFLINE_WARNING_LIMIT_BYTES = 2 * 1024 * 1024;
const LINK_WARNING_CODES = new Set([
  "ambiguous_wikilink",
  "broken_wikilink",
  "pending_wikilink",
  "noncanonical_wikilink"
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = canonicalize(value[key]);
  }
  return result;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalize(value)), "utf8");
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

function assertRelativeContentPath(value, fieldName) {
  if (typeof value !== "string" || !value || value.includes("\\")) {
    throw new Error(`${fieldName} must be a POSIX knowledge-base-relative path`);
  }
  let normalized;
  try {
    normalized = normalizeRelativePosixPath(value);
  } catch (_) {
    throw new Error(`${fieldName} must be a POSIX knowledge-base-relative path`);
  }
  if (normalized !== value || path.posix.isAbsolute(value)) {
    throw new Error(`${fieldName} must be a POSIX knowledge-base-relative path`);
  }
  return value;
}

function validateDetailsRef(detailsRef) {
  assertRelativeContentPath(detailsRef, "details_ref");
  if (path.posix.basename(detailsRef) !== "graph-warnings.json") {
    throw new Error("details_ref must name graph-warnings.json");
  }
  return detailsRef;
}

function normalizeOccurrence(occurrence) {
  if (!occurrence || typeof occurrence !== "object") {
    throw new Error("warning occurrence must be an object");
  }
  assertRelativeContentPath(occurrence.source_path, "source_path");
  return canonicalize(occurrence);
}

function normalizeCandidateSets(candidateSets) {
  if (!Array.isArray(candidateSets)) throw new Error("candidateSets must be an array");
  const seen = new Set();
  return candidateSets.map((candidateSet) => {
    if (!candidateSet || typeof candidateSet !== "object" || !candidateSet.candidate_set_id) {
      throw new Error("candidate_set_id is required");
    }
    if (seen.has(candidateSet.candidate_set_id)) {
      throw new Error(`duplicate candidate_set_id: ${candidateSet.candidate_set_id}`);
    }
    seen.add(candidateSet.candidate_set_id);
    const candidates = Array.from(new Set((candidateSet.candidates || []).map((candidate) => (
      assertRelativeContentPath(candidate, "candidate path")
    )))).sort(compareText);
    if (candidateSet.candidate_count !== candidates.length) {
      throw new Error(`candidate_count does not match candidates for ${candidateSet.candidate_set_id}`);
    }
    return canonicalize({ ...candidateSet, candidates });
  }).sort((left, right) => compareText(left.candidate_set_id, right.candidate_set_id));
}

function normalizeGroups(groups, candidateSetIds) {
  if (!Array.isArray(groups)) throw new Error("groups must be an array");
  const seen = new Set();
  return groups.map((group) => {
    if (!group || typeof group !== "object" || !group.warning_id) {
      throw new Error("warning_id is required");
    }
    if (seen.has(group.warning_id)) throw new Error(`duplicate warning_id: ${group.warning_id}`);
    seen.add(group.warning_id);
    if (group.candidate_set_id && !candidateSetIds.has(group.candidate_set_id)) {
      throw new Error(`warning references missing candidate set: ${group.candidate_set_id}`);
    }
    if (!Number.isSafeInteger(group.occurrence_count) || group.occurrence_count < 0) {
      throw new Error(`invalid occurrence_count for ${group.warning_id}`);
    }
    const occurrences = (group.occurrences || []).map(normalizeOccurrence)
      .sort((left, right) => compareText(left.occurrence_id, right.occurrence_id));
    if (LINK_WARNING_CODES.has(group.code) && group.occurrence_count !== occurrences.length) {
      throw new Error(`occurrence_count does not match occurrences for ${group.warning_id}`);
    }
    if (occurrences.length > group.occurrence_count) {
      throw new Error(`occurrence_count is smaller than occurrences for ${group.warning_id}`);
    }
    return canonicalize({ ...group, occurrences });
  }).sort((left, right) => compareText(left.warning_id, right.warning_id));
}

function sortGraphCollections(graphData) {
  const graph = structuredClone(graphData || {});
  if (graph.meta && typeof graph.meta === "object") delete graph.meta.warning_summary;
  if (Array.isArray(graph.nodes)) graph.nodes.sort((left, right) => compareText(left.id, right.id));
  if (Array.isArray(graph.edges)) {
    graph.edges.sort((left, right) => compareText(
      `${left.id || ""}\0${left.from || ""}\0${left.to || ""}`,
      `${right.id || ""}\0${right.from || ""}\0${right.to || ""}`
    ));
  }
  if (graph.learning && Array.isArray(graph.learning.communities)) {
    graph.learning.communities.sort((left, right) => compareText(left.id, right.id));
  }
  return canonicalize(graph);
}

function canonicalWarningDetailBytes(bundle) {
  return canonicalBytes({
    version: bundle.version,
    build_id: bundle.build_id,
    candidate_sets: bundle.candidate_sets,
    groups: bundle.groups
  });
}

function assembleGraphArtifactPair({
  graphData,
  groups,
  candidateSets,
  detailsRef = DEFAULT_WARNING_DETAILS_REF
}) {
  const validatedDetailsRef = validateDetailsRef(detailsRef);
  const candidate_sets = normalizeCandidateSets(candidateSets);
  const normalizedGroups = normalizeGroups(groups, new Set(candidate_sets.map((item) => item.candidate_set_id)));
  const graphWithoutSummary = sortGraphCollections(graphData);
  const build_id = sha256(canonicalBytes({
    graph_without_warning_summary: graphWithoutSummary,
    warning_details: { candidate_sets, groups: normalizedGroups }
  }));
  const detailProjection = {
    version: 1,
    build_id,
    candidate_sets,
    groups: normalizedGroups
  };
  const details_sha256 = sha256(canonicalBytes(detailProjection));
  const byCode = {};
  let errorOccurrences = 0;
  let warningOccurrences = 0;
  for (const group of normalizedGroups) {
    byCode[group.code] = (byCode[group.code] || 0) + group.occurrence_count;
    if (group.severity === "error") errorOccurrences += group.occurrence_count;
    else warningOccurrences += group.occurrence_count;
  }
  const summary = canonicalize({
    build_id,
    total_groups: normalizedGroups.length,
    total_occurrences: errorOccurrences + warningOccurrences,
    error_occurrences: errorOccurrences,
    warning_occurrences: warningOccurrences,
    by_code: byCode,
    details_ref: validatedDetailsRef,
    details_sha256
  });
  const normalizedGraph = canonicalize({
    ...graphWithoutSummary,
    meta: { ...(graphWithoutSummary.meta || {}), warning_summary: summary }
  });
  const warningBundle = canonicalize({
    version: 1,
    build_id,
    summary,
    candidate_sets,
    groups: normalizedGroups
  });
  return { graphData: normalizedGraph, warningBundle };
}

function summariesMatch(left, right) {
  return Boolean(left && right && canonicalBytes(left).equals(canonicalBytes(right)));
}

function graphWithoutWarningSummary(graphData) {
  return sortGraphCollections(graphData);
}

function recalculateBuildId(graphData, warningBundle) {
  return sha256(canonicalBytes({
    graph_without_warning_summary: graphWithoutWarningSummary(graphData),
    warning_details: {
      candidate_sets: warningBundle.candidate_sets,
      groups: warningBundle.groups
    }
  }));
}

function parseArtifactBytes(bytes) {
  return JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes));
}

function validateArtifactObjects({ graphData, warningBundle, expectedDetailsRef }) {
  const summary = graphData && graphData.meta && graphData.meta.warning_summary;
  if (!summary || typeof summary !== "object") {
    return { status: "unavailable", reason: "invalid", summary: summary || null };
  }

  try {
    validateDetailsRef(summary.details_ref);
  } catch (_) {
    return { status: "unavailable", reason: "invalid", summary };
  }
  if (summary.details_ref !== expectedDetailsRef) {
    return { status: "unavailable", reason: "details_ref_mismatch", summary };
  }
  if (!warningBundle || typeof warningBundle !== "object" || warningBundle.version !== 1) {
    return { status: "unavailable", reason: "invalid", summary };
  }
  if (summary.build_id !== warningBundle.build_id || !summariesMatch(summary, warningBundle.summary)) {
    return { status: "unavailable", reason: "build_id_mismatch", summary };
  }

  let normalizedSets;
  let normalizedGroups;
  try {
    normalizedSets = normalizeCandidateSets(warningBundle.candidate_sets);
    normalizedGroups = normalizeGroups(
      warningBundle.groups,
      new Set(normalizedSets.map((item) => item.candidate_set_id))
    );
  } catch (_) {
    return { status: "unavailable", reason: "invalid", summary };
  }
  const canonicalBundle = canonicalize({
    ...warningBundle,
    candidate_sets: normalizedSets,
    groups: normalizedGroups
  });
  const actualDetailsSha256 = sha256(canonicalWarningDetailBytes(canonicalBundle));
  if (summary.details_sha256 !== actualDetailsSha256) {
    return { status: "unavailable", reason: "details_sha256_mismatch", summary };
  }
  if (recalculateBuildId(graphData, canonicalBundle) !== summary.build_id) {
    return { status: "unavailable", reason: "build_id_mismatch", summary };
  }

  return { status: "available", graphData, warningBundle: canonicalBundle };
}

function isWithinRoot(rootPath, candidatePath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

async function validateArtifactDestinations({ kbRoot, graphPath, warningPath, detailsRef }) {
  const rootReal = await fsp.realpath(kbRoot);
  const graphAbsolute = path.resolve(graphPath);
  const warningAbsolute = path.resolve(warningPath);
  if (path.basename(graphAbsolute) !== "graph-data.json") {
    throw new Error("graph destination basename must be graph-data.json");
  }
  if (path.basename(warningAbsolute) !== "graph-warnings.json") {
    throw new Error("warning destination basename must be graph-warnings.json");
  }

  const graphParentReal = await fsp.realpath(path.dirname(graphAbsolute));
  const warningParentReal = await fsp.realpath(path.dirname(warningAbsolute));
  if (!isWithinRoot(rootReal, graphParentReal) || !isWithinRoot(rootReal, warningParentReal)) {
    throw new Error("artifact destination must remain inside the knowledge base");
  }
  if (graphParentReal !== warningParentReal) {
    throw new Error("graph-data.json and graph-warnings.json must be sibling artifacts");
  }
  const graphFinal = path.join(graphParentReal, "graph-data.json");
  const warningFinal = path.join(warningParentReal, "graph-warnings.json");
  for (const finalPath of [graphFinal, warningFinal]) {
    try {
      const stat = await fsp.lstat(finalPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`artifact destination is not a regular file: ${finalPath}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const normalizedDetailsRef = validateDetailsRef(detailsRef);
  const detailsAbsolute = path.resolve(rootReal, ...normalizedDetailsRef.split("/"));
  const detailsParentReal = await fsp.realpath(path.dirname(detailsAbsolute));
  const resolvedDetails = path.join(detailsParentReal, path.basename(detailsAbsolute));
  if (!isWithinRoot(rootReal, detailsParentReal) || resolvedDetails !== warningFinal) {
    throw new Error("details_ref does not resolve to the final sibling graph-warnings.json");
  }
  const expectedDetailsRef = path.relative(rootReal, warningFinal).split(path.sep).join("/");
  if (normalizedDetailsRef !== expectedDetailsRef) {
    throw new Error("details_ref does not match the final warning destination");
  }
  return { rootReal, graphFinal, warningFinal, outputParent: graphParentReal, expectedDetailsRef };
}

async function writeSyncedFile(filePath, bytes) {
  const handle = await fsp.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(directoryPath) {
  let handle;
  try {
    handle = await fsp.open(directoryPath, fs.constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EBADF", "EPERM", "EISDIR"].includes(error.code)) throw error;
  } finally {
    if (handle) await handle.close();
  }
}

function operationDirectoryName(name) {
  return /^[a-f0-9]{64}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
}

async function pruneOldOperationDirectories(buildRoot, currentDirectory, now) {
  const entries = await fsp.readdir(buildRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !operationDirectoryName(entry.name)) continue;
    const candidate = path.join(buildRoot, entry.name);
    if (candidate === currentDirectory) continue;
    const stat = await fsp.stat(candidate);
    if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
      await fsp.rm(candidate, { recursive: true, force: true });
    }
  }
}

async function commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair, hooks = {} }) {
  if (!pair || !pair.graphData || !pair.warningBundle) throw new Error("artifact pair is required");
  const summary = pair.graphData.meta && pair.graphData.meta.warning_summary;
  if (!summary) throw new Error("graph warning summary is required");
  const destinations = await validateArtifactDestinations({
    kbRoot,
    graphPath,
    warningPath,
    detailsRef: summary.details_ref
  });
  const stat = hooks.stat || ((target) => fsp.stat(target));
  const tempParent = path.join(destinations.rootReal, ".wiki-tmp");
  await fsp.mkdir(tempParent, { recursive: true, mode: 0o700 });
  const tempParentReal = await fsp.realpath(tempParent);
  if (!isWithinRoot(destinations.rootReal, tempParentReal)) {
    throw new Error("temporary graph build directory escapes knowledge base");
  }
  const buildRoot = path.join(tempParentReal, "graph-build");
  await fsp.mkdir(buildRoot, { recursive: true, mode: 0o700 });

  const [tempDevice, graphDevice, warningDevice] = await Promise.all([
    stat(tempParentReal),
    stat(path.dirname(destinations.graphFinal)),
    stat(path.dirname(destinations.warningFinal))
  ]);
  if (tempDevice.dev !== graphDevice.dev || tempDevice.dev !== warningDevice.dev) {
    throw new Error("graph artifact destinations must use the same filesystem device as .wiki-tmp");
  }

  const graphBytes = Buffer.from(`${JSON.stringify(pair.graphData, null, 2)}\n`, "utf8");
  const warningBytes = Buffer.from(`${JSON.stringify(pair.warningBundle, null, 2)}\n`, "utf8");
  let graphObject;
  let warningObject;
  try {
    graphObject = parseArtifactBytes(graphBytes);
    warningObject = parseArtifactBytes(warningBytes);
  } catch (error) {
    throw new Error(`invalid artifact pair JSON: ${error.message}`);
  }
  const preflight = validateArtifactObjects({
    graphData: graphObject,
    warningBundle: warningObject,
    expectedDetailsRef: destinations.expectedDetailsRef
  });
  if (preflight.status !== "available") {
    throw new Error(`invalid artifact pair: ${preflight.reason}`);
  }

  const operationDirectory = path.join(
    buildRoot,
    `${summary.build_id}-${crypto.randomUUID()}`
  );
  await fsp.mkdir(operationDirectory, { recursive: false, mode: 0o700 });
  const tempGraph = path.join(operationDirectory, "graph-data.json");
  const tempWarning = path.join(operationDirectory, "graph-warnings.json");

  await writeSyncedFile(tempGraph, graphBytes);
  await writeSyncedFile(tempWarning, warningBytes);
  const verifiedTemporary = validateArtifactObjects({
    graphData: parseArtifactBytes(await fsp.readFile(tempGraph)),
    warningBundle: parseArtifactBytes(await fsp.readFile(tempWarning)),
    expectedDetailsRef: destinations.expectedDetailsRef
  });
  if (verifiedTemporary.status !== "available") {
    throw new Error(`temporary artifact verification failed: ${verifiedTemporary.reason}`);
  }

  await fsp.rename(tempWarning, destinations.warningFinal);
  await fsyncDirectory(destinations.outputParent);
  if (hooks.afterWarningReplace) await hooks.afterWarningReplace();
  await fsp.rename(tempGraph, destinations.graphFinal);
  await fsyncDirectory(destinations.outputParent);
  await fsp.rm(operationDirectory, { recursive: true, force: true });
  await pruneOldOperationDirectories(
    buildRoot,
    operationDirectory,
    hooks.now ? hooks.now() : Date.now()
  );
}

async function verifyGraphArtifactPair({ kbRoot, graphPath, warningPath }) {
  let graphData;
  try {
    graphData = parseArtifactBytes(await fsp.readFile(graphPath));
  } catch (_) {
    return { status: "unavailable", reason: "invalid", summary: null };
  }
  const summary = graphData && graphData.meta && graphData.meta.warning_summary;
  if (!summary || typeof summary !== "object") {
    return { status: "unavailable", reason: "invalid", summary: summary || null };
  }

  let destinations;
  try {
    destinations = await validateArtifactDestinations({
      kbRoot,
      graphPath,
      warningPath,
      detailsRef: summary.details_ref
    });
  } catch (error) {
    return {
      status: "unavailable",
      reason: error.message.includes("details_ref") ? "details_ref_mismatch" : "invalid",
      summary
    };
  }

  let warningBytes;
  try {
    warningBytes = await fsp.readFile(destinations.warningFinal);
  } catch (error) {
    return {
      status: "unavailable",
      reason: error.code === "ENOENT" ? "missing" : "invalid",
      summary
    };
  }
  let warningBundle;
  try {
    warningBundle = parseArtifactBytes(warningBytes);
  } catch (_) {
    return { status: "unavailable", reason: "invalid", summary };
  }
  return validateArtifactObjects({
    graphData,
    warningBundle,
    expectedDetailsRef: destinations.expectedDetailsRef
  });
}

function canonicalOfflineBundle(bundle) {
  const candidate_sets = (bundle.candidate_sets || []).map((candidateSet) => canonicalize({
    ...candidateSet,
    candidates: (candidateSet.candidates || []).slice().sort(compareText)
  })).sort((left, right) => compareText(left.candidate_set_id, right.candidate_set_id));
  const groups = (bundle.groups || []).map((group) => canonicalize({
    ...group,
    occurrences: (group.occurrences || []).slice()
      .sort((left, right) => compareText(left.occurrence_id, right.occurrence_id))
  })).sort((left, right) => compareText(left.warning_id, right.warning_id));
  return canonicalize({ ...bundle, candidate_sets, groups });
}

function offlinePayload(summary, bundle, truncated, omittedGroupCount, omittedCandidateSetCount) {
  return canonicalize({
    summary,
    details_status: "available",
    details_unavailable_reason: null,
    warning_details_truncated: truncated,
    omitted_group_count: omittedGroupCount,
    omitted_candidate_set_count: omittedCandidateSetCount,
    bundle
  });
}

function compressedPayloadBytes(payload) {
  return zlib.gzipSync(canonicalBytes(payload), { level: 9 }).length;
}

function prepareOfflineWarningPayload({
  summary,
  bundle,
  maxCompressedBytes = OFFLINE_WARNING_LIMIT_BYTES
}) {
  if (!Number.isSafeInteger(maxCompressedBytes) || maxCompressedBytes <= 0) {
    throw new Error("maxCompressedBytes must be a positive integer");
  }
  const completeBundle = canonicalOfflineBundle(bundle);
  let payload = offlinePayload(summary, completeBundle, false, 0, 0);
  let compressedBytes = compressedPayloadBytes(payload);
  if (compressedBytes <= maxCompressedBytes) return { payload, compressedBytes };

  const compactBundle = canonicalOfflineBundle({
    ...completeBundle,
    groups: completeBundle.groups.map((group) => ({
      ...group,
      occurrences: group.occurrences.slice(0, 20)
    })),
    candidate_sets: completeBundle.candidate_sets.map((candidateSet) => ({
      ...candidateSet,
      candidates: candidateSet.candidates.slice(0, 20)
    }))
  });
  let omittedGroupCount = 0;
  let omittedCandidateSetCount = 0;
  const refresh = () => {
    payload = offlinePayload(summary, compactBundle, true, omittedGroupCount, omittedCandidateSetCount);
    compressedBytes = compressedPayloadBytes(payload);
    return compressedBytes <= maxCompressedBytes;
  };
  if (refresh()) return { payload, compressedBytes };

  for (let index = compactBundle.groups.length - 1; index >= 0; index -= 1) {
    if (compactBundle.groups[index].occurrences.length === 0) continue;
    compactBundle.groups[index] = canonicalize({ ...compactBundle.groups[index], occurrences: [] });
    if (refresh()) return { payload, compressedBytes };
  }
  for (let index = compactBundle.candidate_sets.length - 1; index >= 0; index -= 1) {
    if (compactBundle.candidate_sets[index].candidates.length === 0) continue;
    compactBundle.candidate_sets[index] = canonicalize({
      ...compactBundle.candidate_sets[index],
      candidates: []
    });
    if (refresh()) return { payload, compressedBytes };
  }

  while (compactBundle.groups.length > 0) {
    compactBundle.groups.pop();
    omittedGroupCount += 1;
    if (refresh()) return { payload, compressedBytes };
  }
  while (compactBundle.candidate_sets.length > 0) {
    compactBundle.candidate_sets.pop();
    omittedCandidateSetCount += 1;
    if (refresh()) return { payload, compressedBytes };
  }
  if (!refresh()) {
    throw new Error("offline warning summary exceeds the compressed payload limit");
  }
  return { payload, compressedBytes };
}

module.exports = {
  DEFAULT_WARNING_DETAILS_REF,
  OFFLINE_WARNING_LIMIT_BYTES,
  assembleGraphArtifactPair,
  canonicalWarningDetailBytes,
  commitGraphArtifactPair,
  prepareOfflineWarningPayload,
  verifyGraphArtifactPair
};
