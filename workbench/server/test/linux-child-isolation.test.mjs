import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
	linuxIsolatedCommand,
	resolveExecutable,
} from "./support/linux-child-isolation.mjs";

test("resolves the test command before sudo replaces PATH", async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), "linux-child-isolation-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const executable = path.join(directory, "bash");
	await writeFile(executable, "#!/bin/sh\n", "utf8");
	await chmod(executable, 0o755);

	assert.equal(resolveExecutable("bash", `${directory}:/usr/bin`), executable);
	assert.equal(resolveExecutable("/bin/sh", `${directory}:/usr/bin`), "/bin/sh");
});

test("builds a network namespace command that drops back to the caller", () => {
	assert.deepEqual(
		linuxIsolatedCommand("/test-bin/bash", ["build.sh", "/tmp/kb"], {
			uid: 1001,
			gid: 121,
		}),
		{
			command: "/usr/bin/sudo",
			args: [
				"-n",
				"--preserve-env=HOME,TMPDIR,LANG",
				"/usr/bin/unshare",
				"--net",
				"--fork",
				"/usr/bin/setpriv",
				"--reuid=1001",
				"--regid=121",
				"--clear-groups",
				"--",
				"/test-bin/bash",
				"build.sh",
				"/tmp/kb",
			],
		},
	);
});
