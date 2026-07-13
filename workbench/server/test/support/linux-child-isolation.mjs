import { accessSync, constants } from "node:fs";
import path from "node:path";

export function resolveExecutable(command, pathValue) {
	if (path.isAbsolute(command) || command.includes(path.sep)) return command;
	for (const directory of (pathValue ?? "").split(path.delimiter)) {
		if (!directory) continue;
		const candidate = path.join(directory, command);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Keep searching PATH.
		}
	}
	throw new Error(`cannot resolve isolated child command: ${command}`);
}

export function linuxIsolatedCommand(command, args, { uid, gid }) {
	return {
		command: "/usr/bin/sudo",
		args: [
			"-n",
			"--preserve-env=HOME,TMPDIR,LANG",
			"/usr/bin/unshare",
			"--net",
			"--fork",
			"/usr/bin/setpriv",
			`--reuid=${uid}`,
			`--regid=${gid}`,
			"--clear-groups",
			"--",
			command,
			...args,
		],
	};
}
