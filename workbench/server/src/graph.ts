import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GraphData = {
	meta?: {
		total_nodes?: unknown;
		total_edges?: unknown;
		build_date?: unknown;
		[key: string]: unknown;
	};
	nodes?: unknown[];
	edges?: unknown[];
	[key: string]: unknown;
};

export type GraphReadResult =
	| { ok: true; needsBuild: true; graphPath: string }
	| { ok: true; needsBuild: false; graphPath: string; data: GraphData };

export type GraphBuildStatus = "started" | "queued";

export type GraphEvent =
	| {
			type: "graph_updated";
			kbPath: string;
			diff: null;
			rebuiltAt: string;
			stats: { nodeCount: number; edgeCount: number };
	  }
	| {
			type: "graph_error";
			kbPath: string;
			message: string;
			rebuiltAt: string;
	  };

type RebuildState = {
	running: boolean;
	pending: boolean;
};

const eventBus = new EventEmitter();
const rebuilds = new Map<string, RebuildState>();

export function graphDataPath(kbPath: string): string {
	return path.join(kbPath, "wiki", "graph-data.json");
}

export async function readGraphData(kbPath: string): Promise<GraphReadResult> {
	const graphPath = graphDataPath(kbPath);
	const content = await readFile(graphPath, "utf8").catch((err: NodeJS.ErrnoException) => {
		if (err.code === "ENOENT") return null;
		throw err;
	});
	if (content === null) return { ok: true, needsBuild: true, graphPath };
	const data = JSON.parse(content) as GraphData;
	if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
		throw new Error("graph-data.json 格式不完整");
	}
	return { ok: true, needsBuild: false, graphPath, data };
}

export function triggerGraphRebuild(kbPath: string): { ok: true; status: GraphBuildStatus } {
	const state = rebuilds.get(kbPath) ?? { running: false, pending: false };
	rebuilds.set(kbPath, state);

	if (state.running) {
		state.pending = true;
		return { ok: true, status: "queued" };
	}

	state.running = true;
	void runRebuildLoop(kbPath, state);
	return { ok: true, status: "started" };
}

export function subscribeGraphEvents(listener: (event: GraphEvent) => void): () => void {
	eventBus.on("graph", listener);
	return () => eventBus.off("graph", listener);
}

async function runRebuildLoop(kbPath: string, state: RebuildState): Promise<void> {
	try {
		do {
			state.pending = false;
			await rebuildGraph(kbPath);
			const graph = await readGraphData(kbPath);
			if (!graph.needsBuild) {
				emitGraphEvent({
					type: "graph_updated",
					kbPath,
					diff: null,
					rebuiltAt: new Date().toISOString(),
					stats: {
						nodeCount: Number(graph.data.meta?.total_nodes ?? graph.data.nodes?.length ?? 0),
						edgeCount: Number(graph.data.meta?.total_edges ?? graph.data.edges?.length ?? 0),
					},
				});
			}
		} while (state.pending);
	} catch (err) {
		emitGraphEvent({
			type: "graph_error",
			kbPath,
			message: err instanceof Error ? err.message : String(err),
			rebuiltAt: new Date().toISOString(),
		});
	} finally {
		state.running = false;
		if (state.pending) {
			state.running = true;
			void runRebuildLoop(kbPath, state);
			return;
		}
		rebuilds.delete(kbPath);
	}
}

async function rebuildGraph(kbPath: string): Promise<void> {
	const repoRoot = await findRepoRoot();
	const script = path.join(repoRoot, "scripts", "build-graph-data.sh");
	await access(script);
	await execFileAsync("bash", [script, kbPath], {
		cwd: repoRoot,
		env: process.env,
		maxBuffer: 10 * 1024 * 1024,
	});
}

async function findRepoRoot(): Promise<string> {
	let dir = path.dirname(fileURLToPath(import.meta.url));
	while (true) {
		const gitPath = path.join(dir, ".git");
		const info = await stat(gitPath).catch(() => null);
		if (info) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("Cannot locate repository root from server module path");
}

function emitGraphEvent(event: GraphEvent): void {
	eventBus.emit("graph", event);
}
