import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("community reading regression waits for the proxy token file without reading it", () => {
	const source = readFileSync(
		resolve(import.meta.dirname, "../../../tests/graph-community-reading-experience.regression-1.sh"),
		"utf8",
	);
	const readinessStart = source.indexOf("for _ in $(seq 1 120); do");
	const playwrightStart = source.indexOf("playwright_node_path=", readinessStart);
	assert.ok(readinessStart >= 0 && playwrightStart > readinessStart);

	const readiness = source.slice(readinessStart, playwrightStart);
	assert.match(
		source,
		/capability_token_file="\$tmp_dir\/home\/\.llm-wiki-agent\/runtime\/capability-token"/,
	);
	assert.match(
		readiness,
		/api\/health" >\/dev\/null 2>&1 \\\n\s*&& \[ -s "\$capability_token_file" \] \\\n\s*&& curl -fsS "http:\/\/127\.0\.0\.1:\$web_port"/,
	);
	assert.match(
		readiness,
		/\[ -s "\$capability_token_file" \] \\\n\s*\|\| fail "workbench server did not finish startup/,
	);
});
