const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const {
  loadUnicode17NfcNormalizer
} = require("../../scripts/lib/unicode-normalization");

const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "unicode", "NormalizationTest-17.0.0.txt");
const LICENSE_PATH = path.join(__dirname, "..", "..", "deps", "LICENSE-unicode.txt");
const UNICODE_DATA_PATH = path.join(__dirname, "..", "..", "deps", "unicode", "UnicodeData-17.0.0.txt");
const DERIVED_PROPS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "deps",
  "unicode",
  "DerivedNormalizationProps-17.0.0.txt"
);
const CASE_FOLDING_PATH = path.join(__dirname, "..", "..", "deps", "unicode", "CaseFolding-17.0.0.txt");

const EXPECTED_HASHES = {
  [CASE_FOLDING_PATH]: "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183",
  [UNICODE_DATA_PATH]: "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
  [DERIVED_PROPS_PATH]: "71fd6a206a2c0cdd41feb6b7f656aa31091db45e9cedc926985d718397f9e488",
  [FIXTURE_PATH]: "5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db",
  [LICENSE_PATH]: "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96"
};

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertVendoredUnicodeHashes() {
  for (const [filePath, expectedHash] of Object.entries(EXPECTED_HASHES)) {
    assert.equal(sha256File(filePath), expectedHash, `unexpected SHA-256 for ${path.basename(filePath)}`);
  }
}

function stringFromCodePoints(field) {
  if (!field) return "";
  return String.fromCodePoint(
    ...field.split(/\s+/).filter(Boolean).map((value) => Number.parseInt(value, 16))
  );
}

describe("Unicode 17 NFC normalization", () => {
  it("normalizes with fixed Unicode 17 data", () => {
    assertVendoredUnicodeHashes();

    const nfc = loadUnicode17NfcNormalizer();
    assert.equal(nfc("A\u030A"), "\u00C5");
    assert.equal(nfc("\u212B"), "\u00C5");
    assert.equal(nfc("\u1100\u1161\u11A8"), "\uAC01");
    assert.equal(nfc("q\u0307\u0323"), "q\u0323\u0307");
  });

  it("passes the official Unicode 17 NFC conformance vectors", () => {
    assertVendoredUnicodeHashes();

    const nfc = loadUnicode17NfcNormalizer();
    const lines = fs.readFileSync(FIXTURE_PATH, "utf8").split(/\r?\n/);

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("@Part")) {
        continue;
      }

      const [c1Hex, c2Hex, c3Hex, c4Hex, c5Hex] = trimmed.split("#")[0].split(";").map((part) => part.trim());
      const c1 = stringFromCodePoints(c1Hex);
      const c2 = stringFromCodePoints(c2Hex);
      const c3 = stringFromCodePoints(c3Hex);
      const c4 = stringFromCodePoints(c4Hex);
      const c5 = stringFromCodePoints(c5Hex);

      assert.equal(nfc(c1), c2, `NFC(c1)=c2 failed for ${trimmed}`);
      assert.equal(nfc(c2), c2, `NFC(c2)=c2 failed for ${trimmed}`);
      assert.equal(nfc(c3), c2, `NFC(c3)=c2 failed for ${trimmed}`);
      assert.equal(nfc(c4), c4, `NFC(c4)=c4 failed for ${trimmed}`);
      assert.equal(nfc(c5), c4, `NFC(c5)=c4 failed for ${trimmed}`);
    }
  });
});
