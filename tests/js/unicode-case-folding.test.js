const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  loadUnicode17CaseFolder
} = require("../../scripts/lib/unicode-case-folding");
const {
  loadUnicode17NfcNormalizer
} = require("../../scripts/lib/unicode-normalization");
const { portablePathKey } = require("../../scripts/lib/wiki-link-index");

describe("Unicode 17 default case folding", () => {
  it("uses C/F mappings and excludes Turkic-only behavior", () => {
    const fold = loadUnicode17CaseFolder();
    assert.equal(fold("Straße"), "strasse");
    assert.equal(fold("İ"), "i\u0307");
    assert.equal(fold("K"), "k");
    assert.equal(fold("Σςσ"), "σσσ");
  });

  it("normalizes before and after folding", () => {
    const fold = loadUnicode17CaseFolder();
    assert.equal(fold("CAFÉ"), fold("cafe\u0301"));
  });

  it("does not fall back to host normalization or casing APIs", () => {
    const originalNormalize = String.prototype.normalize;
    const originalToLowerCase = String.prototype.toLowerCase;
    const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase;

    String.prototype.normalize = function normalizeShouldNotRun() {
      throw new Error("host normalize should not run");
    };
    String.prototype.toLowerCase = function toLowerCaseShouldNotRun() {
      throw new Error("host toLowerCase should not run");
    };
    String.prototype.toLocaleLowerCase = function toLocaleLowerCaseShouldNotRun() {
      throw new Error("host toLocaleLowerCase should not run");
    };

    try {
      const nfc = loadUnicode17NfcNormalizer();
      const fold = loadUnicode17CaseFolder();
      assert.equal(nfc("A\u030A"), "\u00C5");
      assert.equal(fold("CAFÉ"), "caf\u00E9");
      assert.equal(fold("cafe\u0301"), "caf\u00E9");
      assert.equal(portablePathKey("./WIKI/CAFÉ.md"), "wiki/caf\u00E9.md");
    } finally {
      String.prototype.normalize = originalNormalize;
      String.prototype.toLowerCase = originalToLowerCase;
      String.prototype.toLocaleLowerCase = originalToLocaleLowerCase;
    }
  });
});
