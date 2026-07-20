import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { watch } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { diffGraphData, normalizeGraphLayoutFile, type GraphData, type GraphDiff, type GraphLayoutFile } from "@llm-wiki/graph-engine";
import type { GraphAuthorityState } from "@llm-wiki/workbench-contracts";

const GRAPH_BUILD_STOP_TIMEOUT_MS = 1_000;
const GRAPH_BUILD_ABORT_GRACE_MS = 100;

export type GraphReadResult =
	| { ok: true; needsBuild: true; graphPath: string }
	| { ok: true; needsBuild: false; graphPath: string; data: GraphData };

export type GraphBuildStatus = "started" | "queued";

export type GraphEvent =
	| {
			type: "graph_updated";
			kbPath: string;
			diff: GraphDiff | null;
			rebuiltAt: string;
			stats: { nodeCount: number; edgeCount: number };
	  }
	| {
			type: "graph_error";
			kbPath: string;
			message: string;
			rebuiltAt: string;
		  };

export type GraphSnapshot =
	| { state: Extract<GraphAuthorityState, { status: "error" }> }
	| ({ state: Extract<GraphAuthorityState, { status: "ready" }> } & (
		| { needsBuild: true }
		| { needsBuild: false; data: GraphData }
	));

type RebuildQueueOptions = {
	run: (signal: AbortSignal) => Promise<void>;
	onError: (err: unknown) => void;
	onIdle?: () => void;
};

type WatchEvent = {
	eventType: string;
	filename: string | null;
};

type WatchHandle = {
	close: () => void;
};

type WatchFactory = (kbPath: string, onEvent: (event: WatchEvent) => void) => WatchHandle;

type WatcherOptions = {
	createWatcher: WatchFactory;
	triggerRebuild: (kbPath: string) => { ok: true; status: GraphBuildStatus };
	debounceMs?: number;
};

const eventBus = new EventEmitter();
const rebuilds = new Map<string, GraphRebuildQueue>();
const activeGraphBuilds = new Map<ChildProcess, Promise<void>>();
let graphWatchController: KnowledgeBaseGraphWatcher | null = null;

export function graphDataPath(kbPath: string): string {
	return path.join(kbPath, "wiki", "graph-data.json");
}

export function graphLayoutPath(kbPath: string): string {
	return path.join(kbPath, ".wiki-graph-layout.json");
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
	if (!graphNodesHavePagePaths(data.nodes)) {
		return { ok: true, needsBuild: true, graphPath };
	}
	return { ok: true, needsBuild: false, graphPath, data };
}

export class GraphAuthorityStore {
	private readonly states = new Map<string, GraphAuthorityState>();

	read(kbPath: string): GraphAuthorityState {
		return this.states.get(kbPath) ?? { status: "ready", rebuiltAt: null };
	}

	record(event: GraphEvent): void {
		this.states.set(
			event.kbPath,
			event.type === "graph_error"
				? {
						status: "error",
						message: event.message,
						rebuiltAt: event.rebuiltAt,
					}
				: { status: "ready", rebuiltAt: event.rebuiltAt },
		);
	}
}

const graphAuthority = new GraphAuthorityStore();

export async function readGraphSnapshot(
	kbPath: string,
	authority: GraphAuthorityStore = graphAuthority,
): Promise<GraphSnapshot> {
	const state = authority.read(kbPath);
	if (state.status === "error") return { state };
	const graph = await readGraphData(kbPath);
	return graph.needsBuild
		? { state, needsBuild: true }
		: { state, needsBuild: false, data: graph.data };
}

function graphNodesHavePagePaths(nodes: GraphData["nodes"]): boolean {
	return nodes.every((node) => {
		const sourcePath = node.source_path || node.path || node.source;
		return typeof sourcePath === "string" && sourcePath.trim().length > 0;
	});
}

export function triggerGraphRebuild(kbPath: string): { ok: true; status: GraphBuildStatus } {
	let queue = rebuilds.get(kbPath);
	if (!queue) {
		queue = createDefaultRebuildQueue(kbPath);
		rebuilds.set(kbPath, queue);
	}
	return queue.trigger();
}

export async function readGraphLayout(kbPath: string): Promise<{ ok: true; layoutPath: string; layout: GraphLayoutFile }> {
	const layoutPath = graphLayoutPath(kbPath);
	const content = await readFile(layoutPath, "utf8").catch((err: NodeJS.ErrnoException) => {
		if (err.code === "ENOENT") return null;
		throw err;
	});
	if (content === null) return { ok: true, layoutPath, layout: emptyGraphLayout() };
	try {
		return { ok: true, layoutPath, layout: normalizeGraphLayout(JSON.parse(content)) };
	} catch {
		return { ok: true, layoutPath, layout: emptyGraphLayout() };
	}
}

export async function writeGraphLayout(kbPath: string, input: unknown): Promise<{ ok: true; layoutPath: string; layout: GraphLayoutFile }> {
	const layoutPath = graphLayoutPath(kbPath);
	const layout = normalizeGraphLayout(input);
	layout.updatedAt = new Date().toISOString();
	await mkdir(path.dirname(layoutPath), { recursive: true });
	await writeFile(layoutPath, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
	return { ok: true, layoutPath, layout };
}

export function subscribeGraphEvents(listener: (event: GraphEvent) => void): () => void {
	eventBus.on("graph", listener);
	return () => eventBus.off("graph", listener);
}

export function watchKnowledgeBaseGraph(kbPath: string): void {
	defaultGraphWatchController().start(kbPath);
}

export function stopKnowledgeBaseGraphWatcher(): void {
	graphWatchController?.stop();
}

export async function stopActiveGraphRebuilds(): Promise<void> {
	const queues = Array.from(rebuilds.values());
	for (const queue of queues) queue.stop();
	const running = Array.from(activeGraphBuilds.keys());
	await waitForGraphBuilds(running, GRAPH_BUILD_ABORT_GRACE_MS);
	const remainingAfterAbort = running.filter((child) => activeGraphBuilds.has(child));
	for (const child of remainingAfterAbort) signalGraphBuildTree(child, "SIGTERM");
	await waitForGraphBuilds(remainingAfterAbort, GRAPH_BUILD_STOP_TIMEOUT_MS);
	const remainingAfterTerminate = remainingAfterAbort.filter((child) => activeGraphBuilds.has(child));
	for (const child of remainingAfterTerminate) signalGraphBuildTree(child, "SIGKILL");
	await waitForGraphBuilds(remainingAfterTerminate, GRAPH_BUILD_STOP_TIMEOUT_MS);
	await Promise.race([
		Promise.allSettled(queues.map((queue) => queue.waitForIdle())),
		new Promise<void>((resolve) => setTimeout(resolve, GRAPH_BUILD_STOP_TIMEOUT_MS)),
	]);
	rebuilds.clear();
}

export function suspendGraphWatcher(kbPath: string): void {
	graphWatchController?.suspend(kbPath);
}

export function resumeGraphWatcher(kbPath: string, options: { trigger?: boolean } = {}): void {
	graphWatchController?.resume(kbPath, options);
}

export function shouldIgnoreGraphWatchPath(filename: string | null): boolean {
	if (!filename) return false;
	const normalized = filename.replaceAll("\\", "/").replace(/^\/+/, "");
	const segments = normalized.split("/").filter(Boolean);
	if (segments.some((segment) => [".wiki-tmp", ".git", ".obsidian", "node_modules", ".DS_Store"].includes(segment))) {
		return true;
	}
	if (normalized === ".wiki-graph-layout.json") return true;
	if (normalized === "wiki/graph-data.json") return true;
	if (normalized === "wiki/graph-warnings.json") return true;
	if (/^wiki\/knowledge-graph.*\.html$/.test(normalized)) return true;
	return false;
}

export class GraphRebuildQueue {
	private running = false;
	private pending = false;
	private stopping = false;
	private activeRun: AbortController | null = null;
	private idleResolvers: Array<() => void> = [];

	constructor(private readonly options: RebuildQueueOptions) {}

	trigger(): { ok: true; status: GraphBuildStatus } {
		if (this.running) {
			this.pending = true;
			return { ok: true, status: "queued" };
		}
		this.running = true;
		void this.runLoop();
		return { ok: true, status: "started" };
	}

	stop(): void {
		this.stopping = true;
		this.pending = false;
		this.activeRun?.abort();
	}

	waitForIdle(): Promise<void> {
		if (!this.running) return Promise.resolve();
		return new Promise((resolve) => this.idleResolvers.push(resolve));
	}

	private async runLoop(): Promise<void> {
		try {
			do {
				this.pending = false;
				const controller = new AbortController();
				this.activeRun = controller;
				try {
					await this.options.run(controller.signal);
				} catch (err) {
					if (!controller.signal.aborted) this.options.onError(err);
				} finally {
					if (this.activeRun === controller) this.activeRun = null;
				}
			} while (this.pending && !this.stopping);
		} finally {
			this.running = false;
			this.options.onIdle?.();
			const resolvers = this.idleResolvers.splice(0);
			for (const resolve of resolvers) resolve();
		}
	}
}

export class KnowledgeBaseGraphWatcher {
	private kbPath: string | null = null;
	private handle: WatchHandle | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private suspendDepth = 0;
	private pendingWhileSuspended = false;
	private readonly debounceMs: number;

	constructor(private readonly options: WatcherOptions) {
		this.debounceMs = options.debounceMs ?? 5000;
	}

	start(kbPath: string): void {
		if (this.kbPath === kbPath && this.handle) return;
		this.stop();
		this.kbPath = kbPath;
		this.handle = this.options.createWatcher(kbPath, (event) => this.handleEvent(event));
	}

	stop(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = null;
		this.pendingWhileSuspended = false;
		this.suspendDepth = 0;
		this.kbPath = null;
		this.handle?.close();
		this.handle = null;
	}

	suspend(kbPath: string): void {
		if (this.kbPath !== kbPath) return;
		this.suspendDepth++;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
			this.pendingWhileSuspended = true;
		}
	}

	resume(kbPath: string, options: { trigger?: boolean } = {}): void {
		if (this.kbPath !== kbPath) return;
		this.suspendDepth = Math.max(0, this.suspendDepth - 1);
		if (this.suspendDepth > 0) return;
		const shouldTrigger = options.trigger === true || this.pendingWhileSuspended;
		this.pendingWhileSuspended = false;
		if (shouldTrigger) this.triggerNow();
	}

	private handleEvent(event: WatchEvent): void {
		if (shouldIgnoreGraphWatchPath(event.filename)) return;
		if (this.suspendDepth > 0) {
			this.pendingWhileSuspended = true;
			return;
		}
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.triggerNow();
		}, this.debounceMs);
	}

	private triggerNow(): void {
		if (!this.kbPath) return;
		this.options.triggerRebuild(this.kbPath);
	}
}

async function rebuildGraph(kbPath: string, signal: AbortSignal): Promise<void> {
	const repoRoot = await findRepoRoot();
	signal.throwIfAborted();
	const script = path.join(repoRoot, "scripts", "build-graph-data.sh");
	await access(script);
	signal.throwIfAborted();
	let child: ChildProcess;
	const completion = new Promise<void>((resolve, reject) => {
		child = spawn(
			"bash",
			[script, kbPath],
			{
				cwd: repoRoot,
				detached: process.platform !== "win32",
				env: process.env,
				stdio: "ignore",
			},
		);
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`graph rebuild exited with ${signal ?? `code ${code}`}`));
		});
	});
	const stopChild = () => signalGraphBuildTree(child, "SIGTERM");
	signal.addEventListener("abort", stopChild, { once: true });
	activeGraphBuilds.set(child!, completion);
	try {
		await completion;
	} finally {
		signal.removeEventListener("abort", stopChild);
		activeGraphBuilds.delete(child!);
	}
}

async function waitForGraphBuilds(children: ChildProcess[], timeoutMs: number): Promise<void> {
	const completions = children
		.map((child) => activeGraphBuilds.get(child))
		.filter((completion): completion is Promise<void> => completion !== undefined);
	if (completions.length === 0) return;
	await Promise.race([
		Promise.allSettled(completions),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

function signalGraphBuildTree(child: ChildProcess, signal: NodeJS.Signals): void {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
	try {
		if (process.platform === "win32") child.kill(signal);
		else process.kill(-child.pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
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

export function graphRebuildFailureMessage(_err: unknown): string {
	return "图谱重建失败";
}

export const GRAPH_REBUILD_FAILURE_LOG_MESSAGE = "[graph] rebuild failed";
export const GRAPH_WATCH_STARTED_LOG_MESSAGE = "[graph] watching knowledge base for graph rebuilds";


function emitGraphEvent(event: GraphEvent): void {
	graphAuthority.record(event);
	eventBus.emit("graph", event);
}

function createDefaultRebuildQueue(kbPath: string): GraphRebuildQueue {
	return new GraphRebuildQueue({
		run: async (signal) => {
			const previous = await readGraphData(kbPath).catch(() => null);
			signal.throwIfAborted();
			await rebuildGraph(kbPath, signal);
			signal.throwIfAborted();
			const graph = await readGraphData(kbPath);
			signal.throwIfAborted();
			if (graph.needsBuild) return;
			emitGraphEvent({
				type: "graph_updated",
				kbPath,
				diff: previous && !previous.needsBuild ? diffGraphData(previous.data, graph.data) : null,
				rebuiltAt: new Date().toISOString(),
				stats: {
					nodeCount: Number(graph.data.meta?.total_nodes ?? graph.data.nodes?.length ?? 0),
					edgeCount: Number(graph.data.meta?.total_edges ?? graph.data.edges?.length ?? 0),
				},
			});
		},
		onError: (err) => {
			console.warn(GRAPH_REBUILD_FAILURE_LOG_MESSAGE);
			emitGraphEvent({
				type: "graph_error",
				kbPath,
				message: graphRebuildFailureMessage(err),
				rebuiltAt: new Date().toISOString(),
			});
		},
		onIdle: () => {
			rebuilds.delete(kbPath);
		},
	});
}

function createFsWatchAdapter(kbPath: string, onEvent: (event: WatchEvent) => void): WatchHandle {
	const watcher = watch(kbPath, { recursive: true }, (eventType, filename) => {
		onEvent({ eventType, filename: filename ? String(filename) : null });
	});
	console.log(GRAPH_WATCH_STARTED_LOG_MESSAGE);
	return { close: () => watcher.close() };
}

function defaultGraphWatchController(): KnowledgeBaseGraphWatcher {
	if (!graphWatchController) {
		graphWatchController = new KnowledgeBaseGraphWatcher({
			createWatcher: createFsWatchAdapter,
			triggerRebuild: triggerGraphRebuild,
		});
	}
	return graphWatchController;
}

function emptyGraphLayout(): GraphLayoutFile {
	return { version: 2, pins: {}, updatedAt: "" };
}

function normalizeGraphLayout(input: unknown): GraphLayoutFile {
	return normalizeGraphLayoutFile(input);
}
