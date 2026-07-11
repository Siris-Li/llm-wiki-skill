import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import {
	BATCH_DIGEST_SSE_SCHEMA_VERSION,
	BatchDigestRequestBodySchema,
	isBatchDigestTerminalEvent,
	type BatchDigestSseEvent,
} from "@llm-wiki/workbench-contracts";

import { runBatchDigest, type BatchDigestEvent, type BatchDigestInput } from "../digest/batch.js";
import { isAbortError } from "../abort.js";
import { resumeGraphWatcher, suspendGraphWatcher } from "../graph.js";
import { parseValidatedBody } from "../http/request.js";
import { OrderedSseWriter } from "../tool-status-events.js";

type BatchDigestEventDraft = BatchDigestSseEvent extends infer Event
	? Event extends BatchDigestSseEvent
		? Omit<Event, "schemaVersion" | "runId" | "batchId" | "seq">
		: never
	: never;

export interface BatchDigestRouteService {
	createRunId: () => string;
	createBatchId: (runId: string) => string;
	runBatchDigest: (
		input: BatchDigestInput,
		emit: (event: BatchDigestEvent) => Promise<void>,
		signal: AbortSignal,
	) => Promise<void>;
	suspendGraphWatcher: (kbPath: string) => void;
	resumeGraphWatcher: (kbPath: string, options: { trigger?: boolean }) => void;
}

export function createBatchDigestRoutes(service: BatchDigestRouteService): Hono {
	const router = new Hono();

	router.post("/knowledge-bases/batch-digest", async (c) => {
		const body = await parseValidatedBody(c, BatchDigestRequestBodySchema);
		const runId = service.createRunId();
		const batchId = service.createBatchId(runId);

		return streamSSE(c, async (stream) => {
			const state = { transportOpen: true, terminalWritten: false };
			const controller = new AbortController();
			const adapter = new BatchDigestEventAdapter(runId, batchId);
			const rawWriter = new OrderedSseWriter(async (payload) => {
				await stream.writeSSE(payload);
			});
			const write = async (event: BatchDigestSseEvent | null) => {
				if (!event || !state.transportOpen || state.terminalWritten) return;
				if (isBatchDigestTerminalEvent(event)) state.terminalWritten = true;
				await rawWriter.writeNamed(event.type, event);
			};

			stream.onAbort(() => {
				state.transportOpen = false;
				controller.abort();
				rawWriter.close();
			});

			service.suspendGraphWatcher(body.kbPath);
			let completed = false;
			try {
				await service.runBatchDigest(
					{
						kbPath: body.kbPath,
						filePaths: body.filePaths,
						concurrency: body.concurrency ?? 3,
						...(body.sourceScanId ? { sourceScanId: body.sourceScanId } : {}),
						...(body.digestModel !== undefined ? { digestModel: body.digestModel } : {}),
					},
					async (event) => write(adapter.adapt(event)),
					controller.signal,
				);
				completed = adapter.completed;
				if (!adapter.finished && state.transportOpen) {
					await write(adapter.fail());
				}
			} catch (err) {
				if (state.transportOpen) {
					await write(isAbortError(err) ? adapter.cancel() : adapter.fail());
				}
			} finally {
				await rawWriter.flush();
				service.resumeGraphWatcher(body.kbPath, { trigger: completed });
				rawWriter.close();
			}
		});
	});

	return router;
}

class BatchDigestEventAdapter {
	private seq = 0;
	private terminalEmitted = false;
	private completedSuccessfully = false;

	constructor(
		private readonly runId: string,
		private readonly batchId: string,
	) {}

	get finished(): boolean {
		return this.terminalEmitted;
	}

	get completed(): boolean {
		return this.completedSuccessfully;
	}

	adapt(event: BatchDigestEvent): BatchDigestSseEvent | null {
		if (this.terminalEmitted) return null;
		switch (event.type) {
			case "start":
				return this.next({
					type: "batch_started",
					total: event.total,
					concurrency: event.concurrency as 1 | 3 | 5,
					outputDir: event.outputDir,
				});
			case "file_start":
				return this.next({ type: "batch_file_started", index: event.index, filePath: event.filePath });
			case "file_progress":
				return this.next({
					type: "batch_file_progress",
					index: event.index,
					filePath: event.filePath,
					chars: event.chars,
				});
			case "file_complete":
				return this.next({
					type: "batch_file_completed",
					index: event.index,
					filePath: event.filePath,
					outputPath: event.outputPath,
				});
			case "file_error":
				return this.next({
					type: "batch_file_failed",
					index: event.index,
					filePath: event.filePath,
					message: event.error,
				});
			case "done": {
				const terminal = this.next({
					type: "batch_completed",
					total: event.total,
					completed: event.completed,
					failed: event.failed,
					outputDir: event.outputDir,
				});
				this.terminalEmitted = true;
				this.completedSuccessfully = true;
				return terminal;
			}
		}
	}

	cancel(): BatchDigestSseEvent | null {
		if (this.terminalEmitted) return null;
		const terminal = this.next({ type: "batch_cancelled", reason: "批量消化已取消" });
		this.terminalEmitted = true;
		return terminal;
	}

	fail(): BatchDigestSseEvent | null {
		if (this.terminalEmitted) return null;
		const terminal = this.next({
			type: "batch_failed",
			code: "INTERNAL_ERROR",
			message: "批量消化失败",
		});
		this.terminalEmitted = true;
		return terminal;
	}

	private next(event: BatchDigestEventDraft): BatchDigestSseEvent {
		return {
			...event,
			schemaVersion: BATCH_DIGEST_SSE_SCHEMA_VERSION,
			runId: this.runId,
			batchId: this.batchId,
			seq: ++this.seq,
		} as BatchDigestSseEvent;
	}
}

export const defaultBatchDigestRouteService: BatchDigestRouteService = {
	createRunId: () => `batch-run-${randomUUID()}`,
	createBatchId: (runId) => `batch-${runId}`,
	runBatchDigest,
	suspendGraphWatcher,
	resumeGraphWatcher,
};
