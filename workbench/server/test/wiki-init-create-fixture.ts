import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { chmod, cp, lstat, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
	createWiki,
	initExistingWiki,
	KnowledgeBaseSetupInputError,
} from "../src/wiki-init.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const home = process.env.HOME;

if (!home) throw new Error("HOME is required for wiki initialization fixture");

await installInitSkill(home);
const target = join(home, "llm-wiki", "research");
await mkdir(target, { recursive: true });
await writeFile(join(target, "index.md"), "keep this index\n");

await assert.rejects(
	() => createWiki("research", "replacement purpose"),
	(err) =>
		err instanceof KnowledgeBaseSetupInputError &&
		err.message === "该知识库名称已存在，请换一个名称",
);
assert.equal(await readFile(join(target, "index.md"), "utf8"), "keep this index\n");

const gate = join(home, "initialization-gate");
const started = join(home, "initialization-started");
await execFileAsync("mkfifo", [gate]);
await writeInitScript(
	home,
	`#!/bin/bash
set -eu
WIKI_ROOT="$1"
printf '%s\n' "$WIKI_ROOT" > "$HOME/initialization-started"
cat "$HOME/initialization-gate" >/dev/null
mkdir -p "$WIKI_ROOT"
printf 'created by default\n' > "$WIKI_ROOT/index.md"
touch "$WIKI_ROOT/.wiki-schema.md"
`,
);
const lockedTarget = join(home, "llm-wiki", "locked");
const lockedAlias = join(home, "locked-alias");
await symlink(lockedTarget, lockedAlias);
const creation = createWiki("locked", "default purpose");
await waitForFile(started);
const existingInitialization = initExistingWiki(lockedAlias, "existing purpose", true);
const caseVariantInitialization = initExistingWiki(
	join(home, "llm-wiki", "LOCKED"),
	"case variant purpose",
	true,
);
const initializationResults = Promise.allSettled([
	creation,
	existingInitialization,
	caseVariantInitialization,
]);
await writeFile(gate, "continue\n");
const [created, existing, caseVariant] = await initializationResults;
if (created.status === "rejected") throw created.reason;
assert.equal(created.status, "fulfilled");
assert.equal(existing.status, "rejected");
if (existing.status === "rejected") {
	assert.equal((existing.reason as { code?: unknown }).code, "BUSY");
}
assert.equal(caseVariant.status, "rejected");
if (caseVariant.status === "rejected") {
	assert.equal((caseVariant.reason as { code?: unknown }).code, "BUSY");
}
assert.equal(await readFile(join(lockedTarget, "index.md"), "utf8"), "created by default\n");

await writeInitScript(
	home,
	`#!/bin/bash
set -eu
mkdir -p "$1"
printf 'partial\n' > "$1/index.md"
exit 37
`,
);
const retryTarget = join(home, "llm-wiki", "retryable");
await assert.rejects(() => createWiki("retryable", "first attempt"));
await assert.rejects(
	() => lstat(retryTarget),
	(err) => (err as NodeJS.ErrnoException).code === "ENOENT",
);
await restoreInitScript(home);
const retryResult = await createWiki("retryable", "second attempt");
assert.match(await readFile(join(retryTarget, "index.md"), "utf8"), /second attempt/);
assert.ok((await readFile(join(retryTarget, ".wiki-schema.md"), "utf8")).includes(retryTarget));
assert.ok(retryResult.stdout.includes(retryTarget));
assert.equal(retryResult.stdout.includes(".llm-wiki-agent/wiki-create-"), false);

const preservationGate = join(home, "preservation-gate");
const preservationStarted = join(home, "preservation-started");
await execFileAsync("mkfifo", [preservationGate]);
await writeInitScript(
	home,
	`#!/bin/bash
set -eu
printf '%s\n' "$1" > "$HOME/preservation-started"
cat "$HOME/preservation-gate" >/dev/null
exit 39
`,
);
const preservedTarget = join(home, "llm-wiki", "preserved");
const failedCreation = createWiki("preserved", "failed creation");
await waitForFile(preservationStarted);
await mkdir(preservedTarget);
await writeFile(join(preservedTarget, "index.md"), "external content\n");
await writeFile(preservationGate, "continue\n");
await assert.rejects(() => failedCreation);
assert.equal(await readFile(join(preservedTarget, "index.md"), "utf8"), "external content\n");

await writeInitScript(
	home,
	`#!/bin/bash
set -eu
WIKI_ROOT="$1"
mkdir -p "$WIKI_ROOT"
printf 'partial\n' > "$WIKI_ROOT/index.md"
mv "$WIKI_ROOT" "$WIKI_ROOT.moved"
mkdir "$WIKI_ROOT"
printf 'keep replacement\n' > "$WIKI_ROOT/index.md"
exit 38
`,
);
const replacementTarget = join(home, "llm-wiki", "replacement");
await assert.rejects(() => createWiki("replacement", "replacement attempt"));
await assert.rejects(
	() => lstat(replacementTarget),
	(err) => (err as NodeJS.ErrnoException).code === "ENOENT",
);

async function installInitSkill(homeDir: string): Promise<void> {
	const skillRoot = join(homeDir, ".codex", "skills", "llm-wiki-skill");
	const scriptPath = join(skillRoot, "scripts", "init-wiki.sh");
	await mkdir(join(skillRoot, "scripts"), { recursive: true });
	await cp(join(REPO_ROOT, "scripts", "init-wiki.sh"), scriptPath);
	await cp(join(REPO_ROOT, "templates"), join(skillRoot, "templates"), { recursive: true });
	await chmod(scriptPath, 0o755);
}

async function restoreInitScript(homeDir: string): Promise<void> {
	const scriptPath = join(homeDir, ".codex", "skills", "llm-wiki-skill", "scripts", "init-wiki.sh");
	await cp(join(REPO_ROOT, "scripts", "init-wiki.sh"), scriptPath);
	await chmod(scriptPath, 0o755);
}

async function writeInitScript(homeDir: string, content: string): Promise<void> {
	const scriptPath = join(homeDir, ".codex", "skills", "llm-wiki-skill", "scripts", "init-wiki.sh");
	await writeFile(scriptPath, content);
	await chmod(scriptPath, 0o755);
}

async function waitForFile(filePath: string): Promise<void> {
	if (await exists(filePath)) return;
	await new Promise<void>((resolve, reject) => {
		const watcher = watch(dirname(filePath), () => {
			void stat(filePath)
				.then(() => {
					watcher.close();
					resolve();
				})
				.catch(() => undefined);
		});
		watcher.once("error", (err) => {
			watcher.close();
			reject(err);
		});
		void stat(filePath)
			.then(() => {
				watcher.close();
				resolve();
			})
			.catch(() => undefined);
	});
}

async function exists(filePath: string): Promise<boolean> {
	return stat(filePath).then(
		() => true,
		() => false,
	);
}
