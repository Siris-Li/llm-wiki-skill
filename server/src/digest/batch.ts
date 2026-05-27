import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { inspectKnowledgeBasePath } from "../knowledge-bases.js";
import { mapWithConcurrencyLimit } from "./concurrency.js";
import { digestFileWithSubagent } from "./subagent.js";

export type BatchDigestEvent =
	| { type: "start"; total: number; concurrency: number; outputDir: string }
	| { type: "file_start"; index: number; filePath: string }
	| { type: "file_complete"; index: number; filePath: string; outputPath: string }
	| { type: "file_error"; index: number; filePath: string; error: string }
	| { type: "done"; total: number; completed: number; failed: number; outputDir: string };

export interface BatchDigestInput {
	kbPath: string;
	filePaths: string[];
	concurrency?: number;
	sourceRoot?: string;
}

const ALLOWED_EXTS = new Set([".md", ".txt", ".pdf"]);

export async function runBatchDigest(
	input: BatchDigestInput,
	emit: (event: BatchDigestEvent) => Promise<void>,
): Promise<void> {
	const validated = await validateBatchDigestInput(input);
	const purpose = await readPurpose(validated.kbPath);
	const outputDir = path.join(validated.kbPath, "wiki", "synthesis", "sessions");
	await mkdir(outputDir, { recursive: true });

	await emit({
		type: "start",
		total: validated.filePaths.length,
		concurrency: validated.concurrency,
		outputDir,
	});

	const outcomes = await mapWithConcurrencyLimit(
		validated.filePaths,
		validated.concurrency,
		async (filePath, index) => {
			await emit({ type: "file_start", index, filePath });
			try {
				const content = await digestFileWithSubagent({
					kbPath: validated.kbPath,
					filePath,
					purpose,
				});
				const outputPath = await writeDigestOutput(outputDir, filePath, index, content);
				await emit({ type: "file_complete", index, filePath, outputPath });
				return outputPath;
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				await emit({ type: "file_error", index, filePath, error });
				throw err;
			}
		},
	);

	const completed = outcomes.filter((outcome) => outcome.ok).length;
	await emit({
		type: "done",
		total: validated.filePaths.length,
		completed,
		failed: validated.filePaths.length - completed,
		outputDir,
	});
}

async function validateBatchDigestInput(input: BatchDigestInput): Promise<{
	kbPath: string;
	filePaths: string[];
	concurrency: 1 | 3 | 5;
	sourceRoot?: string;
}> {
	const kbPath = await realpath(path.resolve(input.kbPath));
	const kbCheck = await inspectKnowledgeBasePath(kbPath);
	if (!kbCheck.valid) throw new Error(`不是合法知识库（${kbCheck.reason}）：${kbPath}`);

	const concurrency = input.concurrency ?? 3;
	if (![1, 3, 5].includes(concurrency)) {
		throw new Error("concurrency 只能是 1、3 或 5");
	}
	if (!Array.isArray(input.filePaths) || input.filePaths.length === 0) {
		throw new Error("filePaths 不能为空");
	}

	const sourceRoot = input.sourceRoot
		? await realpath(path.resolve(input.sourceRoot))
		: undefined;
	const filePaths: string[] = [];
	for (const filePath of input.filePaths) {
		if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
			throw new Error("filePaths 必须是绝对路径");
		}
		const resolved = await realpath(filePath);
		assertReadableDigestFile(resolved);
		if (!isInside(resolved, kbPath) && !(sourceRoot && isInside(resolved, sourceRoot))) {
			throw new Error(`文件不在知识库或已确认目录下：${resolved}`);
		}
		const info = await stat(resolved);
		if (!info.isFile()) throw new Error(`不是文件：${resolved}`);
		filePaths.push(resolved);
	}

	return {
		kbPath,
		filePaths: Array.from(new Set(filePaths)),
		concurrency: concurrency as 1 | 3 | 5,
		...(sourceRoot ? { sourceRoot } : {}),
	};
}

function assertReadableDigestFile(filePath: string): void {
	const ext = path.extname(filePath).toLowerCase();
	if (!ALLOWED_EXTS.has(ext)) {
		throw new Error(`不支持的文件类型：${filePath}`);
	}
}

async function readPurpose(kbPath: string): Promise<string> {
	for (const rel of ["purpose.md", ".wiki-schema.md"]) {
		const content = await readFile(path.join(kbPath, rel), "utf8").catch(() => "");
		if (content.trim()) return content.trim().slice(0, 2000);
	}
	return "";
}

async function writeDigestOutput(
	outputDir: string,
	sourcePath: string,
	index: number,
	content: string,
): Promise<string> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const base = path.basename(sourcePath, path.extname(sourcePath));
	const slug = slugify(base) || `material-${index + 1}`;
	const outputPath = path.join(outputDir, `${slug}-${timestamp}.md`);
	const body = [
		"---",
		`source: ${JSON.stringify(sourcePath)}`,
		`createdAt: ${JSON.stringify(new Date().toISOString())}`,
		"stage: 3.5-batch-digest",
		"---",
		"",
		content.trim(),
		"",
	].join("\n");
	await writeFile(outputPath, body, "utf8");
	return outputPath;
}

function isInside(target: string, root: string): boolean {
	const relative = path.relative(root, target);
	return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function slugify(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60);
}
