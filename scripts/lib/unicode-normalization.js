#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const UNICODE_DATA_PATH = path.join(__dirname, "../../deps/unicode/UnicodeData-17.0.0.txt");
const DERIVED_NORMALIZATION_PROPS_PATH = path.join(
  __dirname,
  "../../deps/unicode/DerivedNormalizationProps-17.0.0.txt"
);

const EXPECTED_HASHES = {
  [UNICODE_DATA_PATH]: "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
  [DERIVED_NORMALIZATION_PROPS_PATH]: "71fd6a206a2c0cdd41feb6b7f656aa31091db45e9cedc926985d718397f9e488"
};

const HANGUL = {
  SBase: 0xac00,
  LBase: 0x1100,
  VBase: 0x1161,
  TBase: 0x11a7,
  LCount: 19,
  VCount: 21,
  TCount: 28
};
HANGUL.NCount = HANGUL.VCount * HANGUL.TCount;
HANGUL.SCount = HANGUL.LCount * HANGUL.NCount;

let cachedTables = null;
let cachedNormalizer = null;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function verifyRuntimeFile(filePath) {
  const actualHash = sha256(fs.readFileSync(filePath));
  const expectedHash = EXPECTED_HASHES[filePath];

  if (actualHash !== expectedHash) {
    throw new Error(`Unicode runtime data hash mismatch for ${path.basename(filePath)}`);
  }
}

function parseCodePointRange(rangeText) {
  const [startHex, endHex] = rangeText.split("..");
  return {
    start: Number.parseInt(startHex, 16),
    end: Number.parseInt(endHex || startHex, 16)
  };
}

function expandRange(start, end, callback) {
  for (let codePoint = start; codePoint <= end; codePoint += 1) {
    callback(codePoint);
  }
}

function parseDecomposition(rawField) {
  if (!rawField) return null;
  if (rawField.startsWith("<")) return null;
  return rawField.split(/\s+/).filter(Boolean).map((value) => Number.parseInt(value, 16));
}

function pairKey(left, right) {
  return `${left}:${right}`;
}

function lookupRangeValue(ranges, codePoint) {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const entry = ranges[middle];

    if (codePoint < entry.start) {
      high = middle - 1;
    } else if (codePoint > entry.end) {
      low = middle + 1;
    } else {
      return entry.value;
    }
  }

  return 0;
}

function getCanonicalCombiningClass(tables, codePoint) {
  return tables.combiningClasses.get(codePoint) || lookupRangeValue(tables.combiningClassRanges, codePoint);
}

function isHangulSyllable(codePoint) {
  return codePoint >= HANGUL.SBase && codePoint < HANGUL.SBase + HANGUL.SCount;
}

function isHangulL(codePoint) {
  return codePoint >= HANGUL.LBase && codePoint < HANGUL.LBase + HANGUL.LCount;
}

function isHangulV(codePoint) {
  return codePoint >= HANGUL.VBase && codePoint < HANGUL.VBase + HANGUL.VCount;
}

function isHangulT(codePoint) {
  return codePoint > HANGUL.TBase && codePoint < HANGUL.TBase + HANGUL.TCount;
}

function decomposeHangul(codePoint) {
  const sIndex = codePoint - HANGUL.SBase;
  const lIndex = Math.floor(sIndex / HANGUL.NCount);
  const vIndex = Math.floor((sIndex % HANGUL.NCount) / HANGUL.TCount);
  const tIndex = sIndex % HANGUL.TCount;

  const result = [
    HANGUL.LBase + lIndex,
    HANGUL.VBase + vIndex
  ];

  if (tIndex !== 0) {
    result.push(HANGUL.TBase + tIndex);
  }

  return result;
}

function composeHangul(left, right) {
  if (isHangulL(left) && isHangulV(right)) {
    const lIndex = left - HANGUL.LBase;
    const vIndex = right - HANGUL.VBase;
    return HANGUL.SBase + (lIndex * HANGUL.NCount) + (vIndex * HANGUL.TCount);
  }

  if (
    isHangulSyllable(left)
    && ((left - HANGUL.SBase) % HANGUL.TCount === 0)
    && isHangulT(right)
  ) {
    return left + (right - HANGUL.TBase);
  }

  return null;
}

function parseUnicode17NormalizationData(unicodeDataText, derivedPropsText) {
  const combiningClasses = new Map();
  const combiningClassRanges = [];
  const canonicalDecompositions = new Map();
  const compositionExclusions = new Set();
  const compositionMap = new Map();

  let pendingRange = null;

  for (const rawLine of unicodeDataText.split(/\r?\n/)) {
    if (!rawLine) continue;
    const fields = rawLine.split(";");
    if (fields.length < 6) continue;

    const codePoint = Number.parseInt(fields[0], 16);
    const name = fields[1];
    const canonicalCombiningClass = Number.parseInt(fields[3], 10) || 0;
    const decomposition = parseDecomposition(fields[5]);

    if (name.endsWith(", First>")) {
      pendingRange = {
        start: codePoint,
        combiningClass: canonicalCombiningClass,
        decomposition
      };
      continue;
    }

    if (name.endsWith(", Last>") && pendingRange) {
      if (pendingRange.combiningClass !== 0) {
        combiningClassRanges.push({
          start: pendingRange.start,
          end: codePoint,
          value: pendingRange.combiningClass
        });
      }

      if (pendingRange.decomposition) {
        expandRange(pendingRange.start, codePoint, (rangeCodePoint) => {
          canonicalDecompositions.set(rangeCodePoint, pendingRange.decomposition);
        });
      }

      pendingRange = null;
      continue;
    }

    if (canonicalCombiningClass !== 0) {
      combiningClasses.set(codePoint, canonicalCombiningClass);
    }
    if (decomposition) {
      canonicalDecompositions.set(codePoint, decomposition);
    }
  }

  combiningClassRanges.sort((left, right) => left.start - right.start);

  for (const rawLine of derivedPropsText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;

    const [rangeText, property] = line.split(";").map((part) => part.trim());
    if (property !== "Full_Composition_Exclusion") continue;

    const { start, end } = parseCodePointRange(rangeText);
    expandRange(start, end, (codePoint) => {
      compositionExclusions.add(codePoint);
    });
  }

  for (const [composite, decomposition] of canonicalDecompositions.entries()) {
    if (compositionExclusions.has(composite)) continue;
    if (decomposition.length !== 2) continue;
    compositionMap.set(pairKey(decomposition[0], decomposition[1]), composite);
  }

  return Object.freeze({
    combiningClasses,
    combiningClassRanges,
    canonicalDecompositions,
    compositionExclusions,
    compositionMap
  });
}

function recursivelyDecompose(codePoint, tables, output) {
  if (isHangulSyllable(codePoint)) {
    for (const part of decomposeHangul(codePoint)) {
      recursivelyDecompose(part, tables, output);
    }
    return;
  }

  const decomposition = tables.canonicalDecompositions.get(codePoint);
  if (!decomposition) {
    output.push(codePoint);
    return;
  }

  for (const part of decomposition) {
    recursivelyDecompose(part, tables, output);
  }
}

function reorderSegment(segment, combiningClasses) {
  if (segment.length <= 1) return segment;

  const starterCount = combiningClasses[0] === 0 ? 1 : 0;
  const head = segment.slice(0, starterCount);
  const marks = segment.slice(starterCount).map((codePoint, index) => ({
    codePoint,
    ccc: combiningClasses[starterCount + index],
    index
  }));

  marks.sort((left, right) => {
    if (left.ccc !== right.ccc) return left.ccc - right.ccc;
    return left.index - right.index;
  });

  return head.concat(marks.map((item) => item.codePoint));
}

function canonicalOrder(codePoints, tables) {
  const ordered = [];
  let segment = [];
  let classes = [];

  function flush() {
    if (segment.length === 0) return;
    ordered.push(...reorderSegment(segment, classes));
    segment = [];
    classes = [];
  }

  for (const codePoint of codePoints) {
    const ccc = getCanonicalCombiningClass(tables, codePoint);
    if (ccc === 0 && segment.length > 0) {
      flush();
    }
    segment.push(codePoint);
    classes.push(ccc);
  }

  flush();
  return ordered;
}

function recompose(codePoints, tables) {
  if (codePoints.length === 0) return [];

  const result = [codePoints[0]];
  let starterIndex = getCanonicalCombiningClass(tables, codePoints[0]) === 0 ? 0 : -1;
  let starter = starterIndex === 0 ? codePoints[0] : null;
  let lastCombiningClass = getCanonicalCombiningClass(tables, codePoints[0]);

  for (let index = 1; index < codePoints.length; index += 1) {
    const codePoint = codePoints[index];
    const combiningClass = getCanonicalCombiningClass(tables, codePoint);
    let composite = null;

    if (starter !== null) {
      composite = composeHangul(starter, codePoint) || tables.compositionMap.get(pairKey(starter, codePoint)) || null;
    }

    if (composite !== null && (lastCombiningClass < combiningClass || lastCombiningClass === 0)) {
      result[starterIndex] = composite;
      starter = composite;
      continue;
    }

    result.push(codePoint);
    lastCombiningClass = combiningClass;

    if (combiningClass === 0) {
      starterIndex = result.length - 1;
      starter = codePoint;
    }
  }

  return result;
}

function normalizeNfcUnicode17(value, tables) {
  const input = String(value);
  const decomposed = [];

  for (const character of input) {
    recursivelyDecompose(character.codePointAt(0), tables, decomposed);
  }

  const ordered = canonicalOrder(decomposed, tables);
  return String.fromCodePoint(...recompose(ordered, tables));
}

function loadUnicode17NfcNormalizer() {
  if (cachedNormalizer) return cachedNormalizer;

  verifyRuntimeFile(UNICODE_DATA_PATH);
  verifyRuntimeFile(DERIVED_NORMALIZATION_PROPS_PATH);

  cachedTables ||= parseUnicode17NormalizationData(
    fs.readFileSync(UNICODE_DATA_PATH, "utf8"),
    fs.readFileSync(DERIVED_NORMALIZATION_PROPS_PATH, "utf8")
  );
  cachedNormalizer = (value) => normalizeNfcUnicode17(value, cachedTables);
  return cachedNormalizer;
}

module.exports = {
  DERIVED_NORMALIZATION_PROPS_PATH,
  UNICODE_DATA_PATH,
  loadUnicode17NfcNormalizer,
  normalizeNfcUnicode17,
  parseUnicode17NormalizationData
};
