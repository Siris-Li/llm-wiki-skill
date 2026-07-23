#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { loadUnicode17NfcNormalizer } = require("./unicode-normalization");

const TABLE_PATH = path.join(__dirname, "../../deps/unicode/CaseFolding-17.0.0.txt");
const EXPECTED_HASH = "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183";

let cached = null;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseUnicode17CaseFolding(text, normalizeNfc = loadUnicode17NfcNormalizer()) {
  const mappings = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;

    const [sourceHex, status, targetHex] = line.split(";").map((part) => part.trim());
    if (status !== "C" && status !== "F") continue;

    mappings.set(
      Number.parseInt(sourceHex, 16),
      targetHex
        .split(/\s+/)
        .filter(Boolean)
        .map((value) => String.fromCodePoint(Number.parseInt(value, 16)))
        .join("")
    );
  }

  return (value) => {
    let folded = "";
    for (const character of normalizeNfc(String(value))) {
      folded += mappings.get(character.codePointAt(0)) || character;
    }
    return normalizeNfc(folded);
  };
}

function loadUnicode17CaseFolder() {
  if (cached) return cached;

  const content = fs.readFileSync(TABLE_PATH);
  if (sha256(content) !== EXPECTED_HASH) {
    throw new Error(`Unicode runtime data hash mismatch for ${path.basename(TABLE_PATH)}`);
  }

  cached = parseUnicode17CaseFolding(content.toString("utf8"));
  return cached;
}

function defaultCaseFoldUnicode17(value) {
  return loadUnicode17CaseFolder()(value);
}

module.exports = {
  TABLE_PATH,
  defaultCaseFoldUnicode17,
  loadUnicode17CaseFolder,
  parseUnicode17CaseFolding
};
