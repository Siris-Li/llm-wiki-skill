import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkRepositoryPrivacy } from "./check-repository-privacy.mjs";

const checkerPath = fileURLToPath(new URL("./check-repository-privacy.mjs", import.meta.url));

async function fixture(files) {
	const root = await mkdtemp(path.join(os.tmpdir(), "repository-privacy-"));
	for (const [relativePath, content] of Object.entries(files)) {
		const target = path.join(root, relativePath);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	}
	return root;
}

test("reports a personal macOS home path in a protected repository file", async (t) => {
	const personalHome = ["", "Users", "personal-account", "research-vault"].join("/");
	const root = await fixture({
		"README.md": `Evidence: ${personalHome}/notes.md`,
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	assert.deepEqual(await checkRepositoryPrivacy(root), [
		{
			file: "README.md",
			line: 1,
			rule: "absolute-home-path",
			message: "replace a personal home path with a stable generic example",
		},
	]);
});

test("scans protected documentation directories recursively", async (t) => {
	const personalHome = ["", "Users", "personal-account", "research-vault"].join("/");
	const root = await fixture({
		"docs/history/progress.json": JSON.stringify({ evidence: `${personalHome}/graph.json` }),
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	assert.deepEqual(await checkRepositoryPrivacy(root), [
		{
			file: "docs/history/progress.json",
			line: 1,
			rule: "absolute-home-path",
			message: "replace a personal home path with a stable generic example",
		},
	]);
});

test("allows explicit generic home-path examples used by privacy tests", async (t) => {
	const root = await fixture({
		"README.md": [
			"/Users/example/wiki",
			"/Users/private/wiki",
			"/Users/<user>/wiki",
		].join("\n"),
		"docs/example.sh": 'workbench_kb="$tmp_dir/home/llm-wiki/example"',
		"workbench/example.test.ts": 'const home = "/Users/alice/private";',
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	assert.deepEqual(await checkRepositoryPrivacy(root), []);
});

test("reports personal home and machine-specific temp paths across platforms", async (t) => {
	const linuxHome = ["", "home", "personal-account", "vault"].join("/");
	const windowsHome = ["C:", "Users", "personal-account", "vault"].join("\\");
	const macTemp = ["", "var", "folders", "ab", "machine-id", "T", "artifact.json"].join("/");
	const root = await fixture({
		"docs/linux.md": linuxHome,
		"docs/temp.md": macTemp,
		"docs/windows.md": windowsHome,
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	assert.deepEqual(await checkRepositoryPrivacy(root), [
		{
			file: "docs/linux.md",
			line: 1,
			rule: "absolute-home-path",
			message: "replace a personal home path with a stable generic example",
		},
		{
			file: "docs/temp.md",
			line: 1,
			rule: "machine-temp-path",
			message: "replace a machine-specific temporary path with a stable /tmp example",
		},
		{
			file: "docs/windows.md",
			line: 1,
			rule: "absolute-home-path",
			message: "replace a personal home path with a stable generic example",
		},
	]);
});

test("reports a known private name without storing that name in the checker", async (t) => {
	const privateName = ["private", "research", "vault"].join("");
	const fingerprint = createHash("sha256").update(privateName).digest("hex");
	const root = await fixture({
		"docs/history.md": `Used ${privateName} for the verification.`,
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	assert.deepEqual(await checkRepositoryPrivacy(root, {
		sensitiveLiteralFingerprints: new Set([fingerprint]),
	}), [
		{
			file: "docs/history.md",
			line: 1,
			rule: "known-sensitive-literal",
			message: "replace a known private name or material clue with a stable generic example",
		},
	]);
});

test("reports a known multi-word material clue inside surrounding text", async (t) => {
	const privateClue = ["private", "research", "素材"].join(" ");
	const normalizedClue = privateClue
		.normalize("NFC")
		.toLocaleLowerCase("en-US")
		.replace(/[^\p{L}\p{N}]+/gu, "");
	const fingerprint = createHash("sha256").update(normalizedClue).digest("hex");
	const root = await fixture({
		"docs/history.md": `再次记录${privateClue}作为验证样本。`,
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	assert.deepEqual(await checkRepositoryPrivacy(root, {
		sensitiveLiteralFingerprints: new Set(),
		sensitivePhraseFingerprints: [{
			length: [...normalizedClue].length,
			fingerprint,
		}],
	}), [
		{
			file: "docs/history.md",
			line: 1,
			rule: "known-sensitive-literal",
			message: "replace a known private name or material clue with a stable generic example",
		},
	]);
});

test("command exits with failure and a precise location for a representative violation", async (t) => {
	const personalHome = ["", "Users", "personal-account", "research-vault"].join("/");
	const root = await fixture({
		"README.md": `Evidence: ${personalHome}/notes.md`,
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	const result = spawnSync(process.execPath, [checkerPath, root], {
		encoding: "utf8",
	});

	assert.equal(result.status, 1);
	assert.match(result.stderr, /README\.md:1: absolute-home-path:/);
});
