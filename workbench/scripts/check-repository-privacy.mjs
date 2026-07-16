import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_FILES = [
	"README.md",
	"README.en.md",
	"AGENTS.md",
	"CLAUDE.md",
	"packages/graph-engine/CONTEXT.md",
];
const PROTECTED_DIRECTORIES = ["docs", "workbench"];
const IGNORED_DIRECTORIES = new Set([
	".git",
	".tmp",
	"dist",
	"node_modules",
	"test-results",
]);
const TEXT_EXTENSIONS = new Set([
	".cjs",
	".css",
	".html",
	".js",
	".json",
	".jsonl",
	".jsx",
	".md",
	".mdx",
	".mjs",
	".sh",
	".toml",
	".ts",
	".tsx",
	".txt",
	".yaml",
	".yml",
]);
const GENERIC_HOME_SEGMENTS = new Set([
	"<user>",
	"alice",
	"demo",
	"example",
	"person",
	"private",
	"secret",
	"test",
	"user",
	"username",
]);
const SENSITIVE_LITERAL_FINGERPRINTS = new Set([
	"3323a3ed4565b70822389575aeabd907385ae2d425ca858522fc4b32baa42de5",
]);
// Keep known private names and material clues opaque while still blocking re-entry.
const SENSITIVE_PHRASE_FINGERPRINTS = [
	{
		length: 6,
		fingerprint: "0891aafe63991cbad9482d22274f4161e00adb6e1ae76ec13e65568af33aef28",
	},
	{
		length: 7,
		fingerprint: "e725014dda02e97c32c43244722ff7f354713863984c6a9327ed5e7d9210e15f",
	},
	{
		length: 11,
		fingerprint: "5f8a6c75286dd11d423a10f41bc626c4e4ce8b11cb08fb72ef6e659fa8ad3b3f",
	},
	{
		length: 11,
		fingerprint: "95f2e0791ae09608ea4c91507081ea7edec8645d51bed5c4a8bf74a26d00ff7d",
	},
];

function personalHomePath(line) {
	const patterns = [
		/(?:file:\/\/)?\/Users\/([^/\s"'`]+)\//g,
		/(?:^|[\s"'=(])\/home\/([^/\s"'`]+)\//g,
		/(?:[A-Za-z]:|file:\/\/[A-Za-z]:)\\Users\\([^\\\s"'`]+)\\/g,
	];
	for (const pattern of patterns) {
		for (const match of line.matchAll(pattern)) {
			if (!GENERIC_HOME_SEGMENTS.has(match[1].toLowerCase())) return true;
		}
	}
	return false;
}

function machineTempPath(line) {
	return /\/var\/folders\/[^/\s"'`]+\/[^/\s"'`]+\/(?:T|C)\//.test(line);
}

function knownSensitiveLiteral(line, fingerprints) {
	for (const match of line.normalize("NFC").matchAll(/[\p{L}\p{N}_@.-]+/gu)) {
		const fingerprint = createHash("sha256").update(match[0]).digest("hex");
		if (fingerprints.has(fingerprint)) return true;
	}
	return false;
}

function knownSensitivePhrase(line, fingerprints) {
	const characters = [...line
		.normalize("NFC")
		.toLocaleLowerCase("en-US")]
		.filter((character) => /[\p{L}\p{N}]/u.test(character));
	if (
		!characters.some((character) => /[a-z0-9]/u.test(character)) ||
		!characters.some((character) => /\p{Script=Han}/u.test(character))
	) {
		return false;
	}
	for (const { length, fingerprint } of fingerprints) {
		for (let start = 0; start + length <= characters.length; start += 1) {
			const candidate = characters.slice(start, start + length).join("");
			if (createHash("sha256").update(candidate).digest("hex") === fingerprint) return true;
		}
	}
	return false;
}

async function protectedFiles(root) {
	const files = ROOT_FILES.map((file) => path.join(root, file));
	for (const directory of PROTECTED_DIRECTORIES) {
		files.push(...(await textFiles(path.join(root, directory))));
	}
	return [...new Set(files)].sort();
}

async function textFiles(directory) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
	const files = [];
	for (const entry of entries) {
		if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await textFiles(target)));
		else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(target);
	}
	return files;
}

export async function checkRepositoryPrivacy(
	root,
	{
		sensitiveLiteralFingerprints = SENSITIVE_LITERAL_FINGERPRINTS,
		sensitivePhraseFingerprints = SENSITIVE_PHRASE_FINGERPRINTS,
	} = {},
) {
	const absoluteRoot = path.resolve(root);
	const findings = [];
	const lineRules = [
		{
			matches: personalHomePath,
			rule: "absolute-home-path",
			message: "replace a personal home path with a stable generic example",
		},
		{
			matches: machineTempPath,
			rule: "machine-temp-path",
			message: "replace a machine-specific temporary path with a stable /tmp example",
		},
		{
			matches: (line) =>
				knownSensitiveLiteral(line, sensitiveLiteralFingerprints) ||
				knownSensitivePhrase(line, sensitivePhraseFingerprints),
			rule: "known-sensitive-literal",
			message: "replace a known private name or material clue with a stable generic example",
		},
	];
	for (const file of await protectedFiles(absoluteRoot)) {
		const relativePath = path.relative(absoluteRoot, file);
		let source;
		try {
			source = await readFile(file, "utf8");
		} catch (error) {
			if (error?.code === "ENOENT") continue;
			throw error;
		}
		for (const [index, line] of source.split("\n").entries()) {
			for (const { matches, rule, message } of lineRules) {
				if (!matches(line)) continue;
				findings.push({
					file: relativePath,
					line: index + 1,
					rule,
					message,
				});
			}
		}
	}
	return findings.sort((a, b) => `${a.file}:${a.line}:${a.rule}`.localeCompare(`${b.file}:${b.line}:${b.rule}`));
}

async function main() {
	const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
	const findings = await checkRepositoryPrivacy(root);
	if (findings.length === 0) {
		console.log("Repository privacy check passed.");
		return;
	}
	for (const finding of findings) {
		console.error(`${finding.file}:${finding.line}: ${finding.rule}: ${finding.message}`);
	}
	process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
