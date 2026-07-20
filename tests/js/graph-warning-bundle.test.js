"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { describe, it } = require("node:test");
const {
  assembleGraphArtifactPair,
  canonicalWarningDetailBytes,
  commitGraphArtifactPair,
  OFFLINE_WARNING_LIMIT_BYTES,
  prepareOfflineWarningPayload,
  verifyGraphArtifactPair
} = require("../../scripts/lib/graph-warning-bundle");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function graphFixture(label = "Graph") {
  return {
    meta: {
      build_date: "2026-01-01T00:00:00Z",
      wiki_title: label,
      total_nodes: 2,
      total_edges: 1
    },
    nodes: [
      { id: "wiki/entities/a.md", source_path: "wiki/entities/a.md", label: "A", type: "entity" },
      { id: "wiki/topics/b.md", source_path: "wiki/topics/b.md", label: "B", type: "topic" }
    ],
    edges: [{ id: "e1", from: "wiki/entities/a.md", to: "wiki/topics/b.md", type: "EXTRACTED" }],
    insights: { isolated_nodes: [] },
    learning: { communities: [] }
  };
}

function occurrence(id, sourcePath, offset) {
  return {
    occurrence_id: id,
    source_path: sourcePath,
    line: offset + 1,
    column: 1,
    start_byte: offset * 10,
    end_byte: offset * 10 + 7,
    raw_link: "[[foo]]",
    file_sha256: "a".repeat(64),
    link_kind: "page_wikilink",
    read_only: false
  };
}

function candidateSetsFixture() {
  return [{
    candidate_set_id: "candidate-set-four-foo-pages",
    candidate_count: 4,
    candidates: [
      "raw/notes/foo.md",
      "wiki/entities/foo.md",
      "wiki/sources/foo.md",
      "wiki/topics/foo.md"
    ]
  }];
}

function warningGroupsFixture() {
  const first = Array.from({ length: 100 }, (_, index) => (
    occurrence(`occ-a-${String(index).padStart(3, "0")}`, "wiki/entities/a.md", index)
  ));
  const second = Array.from({ length: 100 }, (_, index) => (
    occurrence(`occ-b-${String(index).padStart(3, "0")}`, "wiki/topics/b.md", index)
  ));
  return [
    {
      warning_id: "warning-ambiguity-a",
      code: "ambiguous_wikilink",
      severity: "error",
      message: "Ambiguous wikilink: foo",
      target_key: "foo",
      candidate_set_id: "candidate-set-four-foo-pages",
      occurrence_count: 100,
      occurrences: first
    },
    {
      warning_id: "warning-ambiguity-b",
      code: "ambiguous_wikilink",
      severity: "error",
      message: "Ambiguous wikilink: foo#section",
      target_key: "foo#section",
      candidate_set_id: "candidate-set-four-foo-pages",
      occurrence_count: 100,
      occurrences: second
    },
    {
      warning_id: "warning-broken",
      code: "broken_wikilink",
      severity: "error",
      message: "Broken wikilink: missing",
      target_key: "missing",
      occurrence_count: 1,
      occurrences: [occurrence("occ-broken", "wiki/entities/a.md", 101)]
    }
  ];
}

function reverseLogicalInput(value) {
  return value.slice().reverse().map((item) => ({
    ...item,
    ...(item.candidates ? { candidates: item.candidates.slice().reverse() } : {}),
    ...(item.occurrences ? { occurrences: item.occurrences.slice().reverse() } : {})
  }));
}

describe("graph warning artifact assembly", () => {
  it("stores each candidate set once and gives graph and sidecar the same digest", () => {
    const pair = assembleGraphArtifactPair({
      graphData: graphFixture(),
      groups: warningGroupsFixture(),
      candidateSets: candidateSetsFixture()
    });

    assert.equal(pair.warningBundle.candidate_sets.length, 1);
    assert.equal(pair.warningBundle.groups[0].candidate_set_id, pair.warningBundle.groups[1].candidate_set_id);
    assert.equal(
      pair.graphData.meta.warning_summary.details_sha256,
      pair.warningBundle.summary.details_sha256
    );
    assert.equal(pair.graphData.meta.warning_summary.details_ref, "wiki/graph-warnings.json");
    assert.equal(
      sha256(canonicalWarningDetailBytes(pair.warningBundle)),
      pair.warningBundle.summary.details_sha256
    );
    assert.equal(pair.warningBundle.summary.total_occurrences, 201);
    assert.deepEqual(pair.warningBundle.groups.map((group) => group.warning_id), [
      ...pair.warningBundle.groups.map((group) => group.warning_id)
    ].sort());
  });

  it("assembles byte-identical artifacts from reversed logical input", () => {
    const forward = assembleGraphArtifactPair({
      graphData: graphFixture(),
      groups: warningGroupsFixture(),
      candidateSets: candidateSetsFixture()
    });
    const reversed = assembleGraphArtifactPair({
      graphData: {
        ...graphFixture(),
        nodes: graphFixture().nodes.slice().reverse(),
        edges: graphFixture().edges.slice().reverse()
      },
      groups: reverseLogicalInput(warningGroupsFixture()),
      candidateSets: reverseLogicalInput(candidateSetsFixture())
    });

    assert.equal(JSON.stringify(forward), JSON.stringify(reversed));
  });

  it("rejects malformed identities, counts, paths, and detail references", () => {
    const validGroups = warningGroupsFixture();
    const validSets = candidateSetsFixture();
    const rejects = (overrides, pattern) => assert.throws(() => assembleGraphArtifactPair({
      graphData: graphFixture(),
      groups: validGroups,
      candidateSets: validSets,
      ...overrides
    }), pattern);

    rejects({ groups: [validGroups[0], { ...validGroups[1], warning_id: validGroups[0].warning_id }] }, /duplicate warning_id/i);
    rejects({ candidateSets: [validSets[0], { ...validSets[0] }] }, /duplicate candidate_set_id/i);
    rejects({ groups: [{ ...validGroups[0], candidate_set_id: "missing-set" }] }, /candidate set/i);
    rejects({ groups: [{ ...validGroups[0], occurrence_count: 99 }] }, /occurrence_count/i);
    rejects({ groups: [{
      ...validGroups[2],
      occurrences: [{ ...validGroups[2].occurrences[0], source_path: "/Users/example/wiki/a.md" }]
    }] }, /source_path/i);
    rejects({ detailsRef: "/tmp/graph-warnings.json" }, /details_ref/i);
    rejects({ detailsRef: "../graph-warnings.json" }, /details_ref/i);
    rejects({ detailsRef: "wiki/warnings.json" }, /details_ref/i);
  });

  it("allows positive non-link warning counts without link positions", () => {
    const pair = assembleGraphArtifactPair({
      graphData: graphFixture(),
      groups: [{
        warning_id: "duplicate-node-a",
        code: "duplicate_node_id",
        severity: "error",
        message: "Duplicate node id: a",
        id: "a",
        occurrence_count: 2,
        occurrences: []
      }],
      candidateSets: []
    });
    assert.equal(pair.warningBundle.summary.total_occurrences, 2);
  });
});

async function withKnowledgeBase(run) {
  const kbRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "graph-warning-pair-"));
  await fsp.mkdir(path.join(kbRoot, "wiki"), { recursive: true });
  try {
    await run(kbRoot);
  } finally {
    await fsp.rm(kbRoot, { recursive: true, force: true });
  }
}

function assembledPair(label, detailsRef = "wiki/graph-warnings.json") {
  return assembleGraphArtifactPair({
    graphData: graphFixture(label),
    groups: warningGroupsFixture(),
    candidateSets: candidateSetsFixture(),
    detailsRef
  });
}

describe("graph warning artifact commit and verification", () => {
  it("uses warning-first graph-last replacement and rejects a mixed generation", async () => {
    await withKnowledgeBase(async (kbRoot) => {
      const graphPath = path.join(kbRoot, "wiki", "graph-data.json");
      const warningPath = path.join(kbRoot, "wiki", "graph-warnings.json");
      const pairA = assembledPair("Generation A");
      const pairB = assembledPair("Generation B");

      await commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair: pairA });
      assert.equal((await verifyGraphArtifactPair({ kbRoot, graphPath, warningPath })).status, "available");

      await assert.rejects(
        commitGraphArtifactPair({
          kbRoot,
          graphPath,
          warningPath,
          pair: pairB,
          hooks: { afterWarningReplace: () => { throw new Error("simulated crash"); } }
        }),
        /simulated crash/
      );

      const mixed = await verifyGraphArtifactPair({ kbRoot, graphPath, warningPath });
      assert.deepEqual(mixed, {
        status: "unavailable",
        reason: "build_id_mismatch",
        summary: pairA.graphData.meta.warning_summary
      });

      await commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair: pairB });
      const retried = await verifyGraphArtifactPair({ kbRoot, graphPath, warningPath });
      assert.equal(retried.status, "available");
      assert.equal(retried.warningBundle.build_id, pairB.warningBundle.build_id);
    });
  });

  it("detects sidecar and graph tampering without exposing stale details", async () => {
    await withKnowledgeBase(async (kbRoot) => {
      const graphPath = path.join(kbRoot, "wiki", "graph-data.json");
      const warningPath = path.join(kbRoot, "wiki", "graph-warnings.json");
      const pair = assembledPair("Tamper test");
      await commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair });

      const tamperedWarning = JSON.parse(await fsp.readFile(warningPath, "utf8"));
      tamperedWarning.candidate_sets[0].candidates[0] = "wiki/topics/tampered.md";
      await fsp.writeFile(warningPath, `${JSON.stringify(tamperedWarning)}\n`);
      const detailMismatch = await verifyGraphArtifactPair({ kbRoot, graphPath, warningPath });
      assert.deepEqual(detailMismatch, {
        status: "unavailable",
        reason: "details_sha256_mismatch",
        summary: pair.graphData.meta.warning_summary
      });
      assert.equal("warningBundle" in detailMismatch, false);

      await commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair });
      const tamperedGraph = JSON.parse(await fsp.readFile(graphPath, "utf8"));
      tamperedGraph.nodes[0].label = "Tampered";
      await fsp.writeFile(graphPath, `${JSON.stringify(tamperedGraph)}\n`);
      const graphMismatch = await verifyGraphArtifactPair({ kbRoot, graphPath, warningPath });
      assert.equal(graphMismatch.status, "unavailable");
      assert.equal(graphMismatch.reason, "build_id_mismatch");
      assert.deepEqual(graphMismatch.summary, pair.graphData.meta.warning_summary);
    });
  });

  it("preserves the graph summary when the sidecar is missing or malformed", async () => {
    await withKnowledgeBase(async (kbRoot) => {
      const graphPath = path.join(kbRoot, "wiki", "graph-data.json");
      const warningPath = path.join(kbRoot, "wiki", "graph-warnings.json");
      const pair = assembledPair("Unavailable details");
      await commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair });

      await fsp.rm(warningPath);
      assert.deepEqual(await verifyGraphArtifactPair({ kbRoot, graphPath, warningPath }), {
        status: "unavailable",
        reason: "missing",
        summary: pair.graphData.meta.warning_summary
      });

      await fsp.writeFile(warningPath, "{not-json");
      assert.deepEqual(await verifyGraphArtifactPair({ kbRoot, graphPath, warningPath }), {
        status: "unavailable",
        reason: "invalid",
        summary: pair.graphData.meta.warning_summary
      });
    });
  });

  it("keeps custom artifact pairs isolated in their own sibling directories", async () => {
    await withKnowledgeBase(async (kbRoot) => {
      for (const directory of ["exports/first", "exports/second"]) {
        await fsp.mkdir(path.join(kbRoot, directory), { recursive: true });
      }
      const destinations = ["exports/first", "exports/second"];
      for (const [index, directory] of destinations.entries()) {
        const graphPath = path.join(kbRoot, directory, "graph-data.json");
        const warningPath = path.join(kbRoot, directory, "graph-warnings.json");
        const pair = assembledPair(`Custom ${index}`, `${directory}/graph-warnings.json`);
        await commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair });
        const verified = await verifyGraphArtifactPair({ kbRoot, graphPath, warningPath });
        assert.equal(verified.status, "available");
        assert.equal(verified.graphData.meta.warning_summary.details_ref, `${directory}/graph-warnings.json`);
      }
      assert.equal(fs.existsSync(path.join(kbRoot, "wiki", "graph-warnings.json")), false);

      const firstGraph = path.join(kbRoot, "exports/first/graph-data.json");
      const firstWarning = path.join(kbRoot, "exports/first/graph-warnings.json");
      const replacement = assembledPair("Custom replacement", "exports/first/graph-warnings.json");
      await commitGraphArtifactPair({
        kbRoot,
        graphPath: firstGraph,
        warningPath: firstWarning,
        pair: replacement
      });
      assert.equal(
        (await verifyGraphArtifactPair({ kbRoot, graphPath: firstGraph, warningPath: firstWarning })).warningBundle.build_id,
        replacement.warningBundle.build_id
      );
    });
  });

  it("rejects unsafe or mismatched destinations before replacing output", async () => {
    await withKnowledgeBase(async (kbRoot) => {
      const pair = assembledPair("Safety");
      const wiki = path.join(kbRoot, "wiki");
      const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "graph-warning-outside-"));
      try {
        const cases = [
          {
            graphPath: path.join(outside, "graph-data.json"),
            warningPath: path.join(outside, "graph-warnings.json"),
            pattern: /knowledge base/i
          },
          {
            graphPath: path.join(wiki, "custom.json"),
            warningPath: path.join(wiki, "graph-warnings.json"),
            pattern: /graph-data\.json/i
          },
          {
            graphPath: path.join(wiki, "graph-data.json"),
            warningPath: path.join(wiki, "warnings.json"),
            pattern: /graph-warnings\.json/i
          }
        ];
        await fsp.mkdir(path.join(kbRoot, "exports"), { recursive: true });
        cases.push({
          graphPath: path.join(wiki, "graph-data.json"),
          warningPath: path.join(kbRoot, "exports", "graph-warnings.json"),
          pattern: /sibling/i
        });
        for (const testCase of cases) {
          await assert.rejects(commitGraphArtifactPair({
            kbRoot,
            graphPath: testCase.graphPath,
            warningPath: testCase.warningPath,
            pair
          }), testCase.pattern);
        }

        const customPair = assembledPair("Wrong ref", "exports/graph-warnings.json");
        await assert.rejects(commitGraphArtifactPair({
          kbRoot,
          graphPath: path.join(wiki, "graph-data.json"),
          warningPath: path.join(wiki, "graph-warnings.json"),
          pair: customPair
        }), /details_ref/i);

        assert.equal(fs.existsSync(path.join(wiki, "graph-data.json")), false);
        assert.equal(fs.existsSync(path.join(wiki, "graph-warnings.json")), false);
      } finally {
        await fsp.rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("rejects cross-device destinations before replacement", async () => {
    await withKnowledgeBase(async (kbRoot) => {
      const graphPath = path.join(kbRoot, "wiki", "graph-data.json");
      const warningPath = path.join(kbRoot, "wiki", "graph-warnings.json");
      const pair = assembledPair("Device safety");
      const realStat = async (target) => fsp.stat(target);
      await assert.rejects(commitGraphArtifactPair({
        kbRoot,
        graphPath,
        warningPath,
        pair,
        hooks: {
          stat: async (target) => {
            const value = await realStat(target);
            if (path.basename(target) === "wiki") {
              return { ...value, dev: Number(value.dev) + 1 };
            }
            return value;
          }
        }
      }), /filesystem device/i);
      assert.equal(fs.existsSync(graphPath), false);
      assert.equal(fs.existsSync(warningPath), false);
    });
  });

  it("retains fresh failed attempts and prunes only old operation-owned directories", async () => {
    await withKnowledgeBase(async (kbRoot) => {
      const now = Date.UTC(2026, 6, 20, 12, 0, 0);
      const graphPath = path.join(kbRoot, "wiki", "graph-data.json");
      const warningPath = path.join(kbRoot, "wiki", "graph-warnings.json");
      const pairA = assembledPair("Cleanup A");
      const pairB = assembledPair("Cleanup B");
      await commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair: pairA, hooks: { now: () => now } });

      await assert.rejects(commitGraphArtifactPair({
        kbRoot,
        graphPath,
        warningPath,
        pair: pairB,
        hooks: {
          now: () => now,
          afterWarningReplace: () => { throw new Error("keep inspection evidence"); }
        }
      }), /keep inspection evidence/);

      const buildRoot = path.join(kbRoot, ".wiki-tmp", "graph-build");
      const failedNames = await fsp.readdir(buildRoot);
      assert.equal(failedNames.length, 1);
      const oldName = `${"f".repeat(64)}-00000000-0000-4000-8000-000000000000`;
      const unrelatedName = "user-owned-directory";
      await fsp.mkdir(path.join(buildRoot, oldName));
      await fsp.mkdir(path.join(buildRoot, unrelatedName));
      const oldDate = new Date(now - 25 * 60 * 60 * 1000);
      await fsp.utimes(path.join(buildRoot, oldName), oldDate, oldDate);
      await fsp.utimes(path.join(buildRoot, unrelatedName), oldDate, oldDate);

      await commitGraphArtifactPair({ kbRoot, graphPath, warningPath, pair: pairB, hooks: { now: () => now } });
      const remaining = await fsp.readdir(buildRoot);
      assert.equal(remaining.includes(oldName), false);
      assert.equal(remaining.includes(unrelatedName), true);
      assert.equal(remaining.some((name) => failedNames.includes(name)), true);
    });
  });
});

function randomish(seed, length) {
  let value = "";
  let counter = 0;
  while (value.length < length) {
    value += crypto.createHash("sha256").update(`${seed}:${counter}`).digest("hex");
    counter += 1;
  }
  return value.slice(0, length);
}

function syntheticBundle(groupCount, occurrencesPerGroup, payloadLength, candidatesPerSet = 30) {
  const candidate_sets = Array.from({ length: Math.max(1, Math.ceil(groupCount / 10)) }, (_, setIndex) => ({
    candidate_set_id: `set-${String(setIndex).padStart(4, "0")}`,
    candidate_count: candidatesPerSet,
    candidates: Array.from({ length: candidatesPerSet }, (_, candidateIndex) => (
      `wiki/entities/${randomish(`candidate-${setIndex}-${candidateIndex}`, Math.max(24, Math.floor(payloadLength / 4)))}.md`
    )).sort()
  }));
  const groups = Array.from({ length: groupCount }, (_, groupIndex) => ({
    warning_id: `warning-${String(groupIndex).padStart(5, "0")}`,
    code: "ambiguous_wikilink",
    severity: "error",
    message: `Ambiguous ${randomish(`message-${groupIndex}`, Math.min(payloadLength, 120))}`,
    target_key: `target-${groupIndex}`,
    candidate_set_id: candidate_sets[groupIndex % candidate_sets.length].candidate_set_id,
    occurrence_count: occurrencesPerGroup,
    occurrences: Array.from({ length: occurrencesPerGroup }, (_, occurrenceIndex) => ({
      occurrence_id: `occ-${String(groupIndex).padStart(5, "0")}-${String(occurrenceIndex).padStart(3, "0")}`,
      source_path: `wiki/topics/source-${groupIndex}.md`,
      line: occurrenceIndex + 1,
      column: 1,
      start_byte: occurrenceIndex * (payloadLength + 1),
      end_byte: occurrenceIndex * (payloadLength + 1) + payloadLength,
      raw_link: `[[${randomish(`raw-${groupIndex}-${occurrenceIndex}`, payloadLength)}]]`,
      file_sha256: randomish(`file-${groupIndex}`, 64),
      link_kind: "page_wikilink",
      read_only: false
    }))
  }));
  const total = groupCount * occurrencesPerGroup;
  const summary = {
    build_id: randomish(`build-${groupCount}-${payloadLength}`, 64),
    total_groups: groupCount,
    total_occurrences: total,
    error_occurrences: total,
    warning_occurrences: 0,
    by_code: { ambiguous_wikilink: total },
    details_ref: "wiki/graph-warnings.json",
    details_sha256: randomish(`details-${groupCount}-${payloadLength}`, 64)
  };
  return { version: 1, build_id: summary.build_id, summary, candidate_sets, groups };
}

function embeddedCompressedBytes(payload) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 }).length;
}

describe("offline warning payload budget", () => {
  it("embeds complete details below the limit and deterministically truncates details above it", () => {
    const completeBundle = assembledPair("Offline small").warningBundle;
    const small = prepareOfflineWarningPayload({ summary: completeBundle.summary, bundle: completeBundle });
    assert.equal(small.payload.warning_details_truncated, false);
    assert.deepEqual(small.payload.bundle, completeBundle);
    assert.equal(small.compressedBytes, embeddedCompressedBytes(small.payload));

    const nearLimitBundle = syntheticBundle(140, 30, 800);
    const nearLimitBytes = embeddedCompressedBytes({
      summary: nearLimitBundle.summary,
      details_status: "available",
      details_unavailable_reason: null,
      warning_details_truncated: false,
      omitted_group_count: 0,
      omitted_candidate_set_count: 0,
      bundle: nearLimitBundle
    });
    assert.ok(nearLimitBytes < OFFLINE_WARNING_LIMIT_BYTES, `near-limit fixture was ${nearLimitBytes} bytes`);
    assert.ok(nearLimitBytes > OFFLINE_WARNING_LIMIT_BYTES * 0.7, `near-limit fixture was only ${nearLimitBytes} bytes`);

    const largeBundle = syntheticBundle(220, 30, 800);
    const large = prepareOfflineWarningPayload({ summary: largeBundle.summary, bundle: largeBundle });
    assert.equal(large.payload.warning_details_truncated, true);
    assert.ok(large.compressedBytes <= OFFLINE_WARNING_LIMIT_BYTES);
    assert.equal(large.compressedBytes, embeddedCompressedBytes(large.payload));
    assert.equal(large.payload.bundle.summary.total_occurrences, largeBundle.summary.total_occurrences);
    assert.ok(large.payload.bundle.groups.every((group) => group.occurrences.length <= 20));
    assert.ok(large.payload.bundle.candidate_sets.every((set) => set.candidates.length <= 20));
    assert.equal(
      large.payload.bundle.groups.length + large.payload.omitted_group_count,
      largeBundle.groups.length
    );
    assert.equal(
      large.payload.bundle.candidate_sets.length + large.payload.omitted_candidate_set_count,
      largeBundle.candidate_sets.length
    );
    const retainedSets = new Set(large.payload.bundle.candidate_sets.map((item) => item.candidate_set_id));
    assert.ok(large.payload.bundle.groups.every((group) => retainedSets.has(group.candidate_set_id)));

    const reversed = {
      ...largeBundle,
      groups: reverseLogicalInput(largeBundle.groups),
      candidate_sets: reverseLogicalInput(largeBundle.candidate_sets)
    };
    assert.deepEqual(
      prepareOfflineWarningPayload({ summary: reversed.summary, bundle: reversed }),
      large
    );
  });

  it("omits stable tail headers when many tiny groups exceed the budget", () => {
    const bundle = syntheticBundle(240, 0, 160, 0);
    const result = prepareOfflineWarningPayload({
      summary: bundle.summary,
      bundle,
      maxCompressedBytes: 1800
    });
    assert.equal(result.payload.warning_details_truncated, true);
    assert.ok(result.compressedBytes <= 1800);
    assert.ok(result.payload.omitted_group_count > 0 || result.payload.omitted_candidate_set_count > 0);
    assert.equal(result.payload.bundle.summary.total_groups, bundle.summary.total_groups);
    assert.equal(result.payload.bundle.summary.total_occurrences, bundle.summary.total_occurrences);
    assert.equal(
      result.payload.bundle.groups.length + result.payload.omitted_group_count,
      bundle.groups.length
    );
    assert.equal(
      result.payload.bundle.candidate_sets.length + result.payload.omitted_candidate_set_count,
      bundle.candidate_sets.length
    );
  });
});
