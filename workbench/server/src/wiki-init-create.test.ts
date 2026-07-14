import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(fileURLToPath(new URL("../../..", import.meta.url)));

test("createWiki protects existing directories and owns its initialization lifecycle", async (t) => {
	const home = await mkdtemp(join(tmpdir(), "llm-wiki-create-lifecycle-"));
	t.after(() => rm(home, { recursive: true, force: true }));

	await execFileAsync(
		process.execPath,
		["--import", "tsx", join(REPO_ROOT, "workbench/server/test/wiki-init-create-fixture.ts")],
		{
			env: { ...process.env, HOME: home },
			maxBuffer: 1024 * 1024,
		},
	);
});
