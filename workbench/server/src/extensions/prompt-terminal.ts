import { open, readFile, rename, rm } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

export const MODEL_FAILURE_MESSAGE = "生成回复时发生错误，请重试";
export const MODEL_CANCELLED_MESSAGE = "生成已停止";
export type AssistantTerminalReason = "error" | "aborted";

type PersistedMessage = Parameters<SessionManager["appendMessage"]>[0];

interface TerminalPersistenceState {
	appendMessage: SessionManager["appendMessage"];
	pendingMessage: AssistantMessage | null;
}

const terminalPersistence = new WeakMap<SessionManager, TerminalPersistenceState>();
const PERSISTED_CANCELLED_TEXT_MARKER = "llm-wiki-terminal-cancelled-text-v1";
const SAFE_TERMINAL_SUMMARY = "此前一轮生成未完成，详细内容未保留。";

/** Tracks text confirmed written to the client for each assistant message. */
export class PublishedAssistantText {
	private currentText = "";
	private finalTerminalText = "";

	append(delta: string): void {
		this.currentText += delta;
	}

	endAssistantMessage(stopReason: unknown): void {
		if (getAssistantTerminalReason(stopReason)) {
			this.finalTerminalText = this.currentText;
		}
		this.currentText = "";
	}

	get terminalText(): string {
		return this.finalTerminalText;
	}
}

/** Creates a safe persisted copy without changing the live message used for retry decisions. */
export function sanitizeAssistantTerminalMessage(
	message: AssistantMessage,
	visibleAssistantText = "",
): AssistantMessage {
	return sanitizeTerminalMessage(message, visibleAssistantText);
}

function sanitizeTerminalMessage(
	message: AssistantMessage,
	visibleAssistantText: string,
): AssistantMessage {
	const terminalReason = getAssistantTerminalReason(message.stopReason);
	return terminalReason
		? createSafeTerminalMessage(
				message as unknown as Record<string, unknown>,
				terminalReason,
				terminalReason === "aborted" ? visibleAssistantText : "",
			)
		: message;
}

export function getAssistantTerminalReason(
	stopReason: unknown,
): AssistantTerminalReason | null {
	return stopReason === "error" || stopReason === "aborted" ? stopReason : null;
}

export function getAssistantTerminalMessage(reason: AssistantTerminalReason): string {
	return reason === "error" ? MODEL_FAILURE_MESSAGE : MODEL_CANCELLED_MESSAGE;
}

/**
 * The SDK decides whether to retry after the message_end listener runs. Intercept only the
 * session write so the live assistant message keeps its retry and overflow classification.
 */
export function protectSessionTerminalMessages(
	sessionManager: SessionManager,
): SessionManager {
	if (terminalPersistence.has(sessionManager)) return sessionManager;
	const state: TerminalPersistenceState = {
		appendMessage: sessionManager.appendMessage.bind(sessionManager),
		pendingMessage: null,
	};
	terminalPersistence.set(sessionManager, state);
	sessionManager.appendMessage = (message) => {
		if (isTerminalAssistantMessage(message)) {
			state.pendingMessage = message;
			return "";
		}
		return state.appendMessage(message);
	};
	return sessionManager;
}

/** Commits the final terminal fact and scrubs the live terminal message after recovery work. */
export function finalizeSessionTerminalMessages(
	sessionManager: SessionManager,
	terminalReason: AssistantTerminalReason | null,
	visibleAssistantText = "",
): boolean {
	const state = terminalPersistence.get(sessionManager);
	if (!state) return false;
	const pendingMessage = state.pendingMessage;
	state.pendingMessage = null;
	if (!pendingMessage || !terminalReason) return false;
	const finalMessage = terminalReason === pendingMessage.stopReason
		? pendingMessage
		: { ...pendingMessage, stopReason: terminalReason };
	const safeMessage = sanitizeTerminalMessage(
		finalMessage,
		pendingMessage.stopReason === "aborted" ? visibleAssistantText : "",
	);
	overwriteAssistantMessage(pendingMessage, safeMessage);
	if (hasVisibleCancelledText(safeMessage)) {
		// Custom entries never become model context; this binds retained text to this writer.
		sessionManager.appendCustomEntry(PERSISTED_CANCELLED_TEXT_MARKER, { version: 1 });
	}
	state.appendMessage(safeMessage);
	return true;
}

/**
 * Removes unsafe terminal payloads from legacy JSONL records before an SDK session restores them.
 * The record is rewritten before it can become model context or a foreground conversation.
 */
export async function sanitizePersistedSessionTerminalMessages(
	sessionFile: string,
): Promise<boolean> {
	let source: string;
	try {
		source = await readFile(sessionFile, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}

	const parsedLines = source
		.split("\n")
		.map((line) => {
			if (!line.trim()) return { line, entry: null };
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				return { line, entry: null };
			}
			return { line, entry };
		});
	const trustedCancelledTextParents = new Set(
		parsedLines
			.map(({ entry }) => entry)
			.filter(isPersistedCancelledTextMarker)
			.map((entry) => entry.id),
	);
	const entriesById = new Map(
		parsedLines
			.map(({ entry }) => entry)
			.filter(isPersistedSessionEntry)
			.map((entry) => [entry.id, entry]),
	);
	const terminalSummarySourceIds = new Set(
		[...entriesById.values()]
			.filter((entry) => isTerminalSummarySource(entry, trustedCancelledTextParents))
			.map((entry) => entry.id),
	);

	let changed = false;
	const rewritten = parsedLines
		.map(({ line, entry }) => {
			if (!entry) return line;
			const safeEntry = sanitizePersistedEntry(
				entry,
				trustedCancelledTextParents,
				entriesById,
				terminalSummarySourceIds,
			);
			if (safeEntry === entry) return line;
			changed = true;
			return JSON.stringify(safeEntry);
		})
		.join("\n");
	if (!changed) return false;

	await rewriteSessionFileAtomically(sessionFile, rewritten);
	return true;
}

function isTerminalAssistantMessage(
	message: PersistedMessage,
): message is AssistantMessage {
	return message.role === "assistant" && getAssistantTerminalReason(message.stopReason) !== null;
}

function sanitizePersistedEntry(
	entry: unknown,
	trustedCancelledTextParents: Set<string>,
	entriesById: ReadonlyMap<string, Record<string, unknown>>,
	terminalSummarySourceIds: ReadonlySet<string>,
): unknown {
	if (!isRecord(entry)) return entry;
	if (entry.type === "message" && isRecord(entry.message)) {
		const preserveCancelledText =
			typeof entry.parentId === "string" && trustedCancelledTextParents.has(entry.parentId);
		const safeMessage = sanitizePersistedTerminalMessage(entry.message, preserveCancelledText);
		return safeMessage ? { ...entry, message: safeMessage } : entry;
	}
	return summaryReferencesTerminal(entry, entriesById, terminalSummarySourceIds)
		? createSafeTerminalSummary(entry)
		: entry;
}

function isPersistedSessionEntry(
	entry: unknown,
): entry is Record<string, unknown> & { id: string } {
	return isRecord(entry) && typeof entry.id === "string";
}

function isTerminalSummarySource(
	entry: Record<string, unknown>,
	trustedCancelledTextParents: Set<string>,
): boolean {
	if (entry.type !== "message" || !isRecord(entry.message)) return false;
	const preserveCancelledText =
		typeof entry.parentId === "string" && trustedCancelledTextParents.has(entry.parentId);
	return sanitizePersistedTerminalMessage(entry.message, preserveCancelledText) !== null;
}

function summaryReferencesTerminal(
	entry: Record<string, unknown>,
	entriesById: ReadonlyMap<string, Record<string, unknown>>,
	terminalSummarySourceIds: ReadonlySet<string>,
): boolean {
	if (isSafeTerminalSummary(entry)) return false;
	if (entry.type === "compaction") {
		return (
			hasTerminalAncestor(entry.parentId, entriesById, terminalSummarySourceIds) ||
			hasTerminalAncestor(entry.firstKeptEntryId, entriesById, terminalSummarySourceIds)
		);
	}
	if (entry.type === "branch_summary") {
		return (
			hasTerminalAncestor(entry.parentId, entriesById, terminalSummarySourceIds) ||
			hasTerminalAncestor(entry.fromId, entriesById, terminalSummarySourceIds)
		);
	}
	return false;
}

function hasTerminalAncestor(
	startId: unknown,
	entriesById: ReadonlyMap<string, Record<string, unknown>>,
	terminalSummarySourceIds: ReadonlySet<string>,
): boolean {
	let currentId = typeof startId === "string" ? startId : null;
	const visited = new Set<string>();
	while (currentId && !visited.has(currentId)) {
		if (terminalSummarySourceIds.has(currentId)) return true;
		visited.add(currentId);
		const current = entriesById.get(currentId);
		currentId = typeof current?.parentId === "string" ? current.parentId : null;
	}
	return false;
}

function isSafeTerminalSummary(entry: Record<string, unknown>): boolean {
	return entry.summary === SAFE_TERMINAL_SUMMARY && !("details" in entry);
}

function createSafeTerminalSummary(entry: Record<string, unknown>): Record<string, unknown> {
	const { details: _details, ...safeEntry } = entry;
	return { ...safeEntry, summary: SAFE_TERMINAL_SUMMARY };
}

function sanitizePersistedTerminalMessage(
	message: Record<string, unknown>,
	preserveCancelledText: boolean,
): AssistantMessage | null {
	if (message.role !== "assistant") return null;
	const terminalReason = getAssistantTerminalReason(message.stopReason);
	if (!terminalReason) return null;
	const visibleAssistantText = terminalReason === "aborted" && preserveCancelledText
		? persistedVisibleAssistantText(message)
		: "";
	const candidate = createSafeTerminalMessage(
		message,
		terminalReason,
		visibleAssistantText,
	);
	return isCanonicalTerminalMessage(message, candidate)
		? null
		: createSafeTerminalMessage(message, terminalReason, "");
}

function isPersistedCancelledTextMarker(
	entry: unknown,
): entry is Record<string, unknown> & { id: string } {
	return (
		isRecord(entry) &&
		entry.type === "custom" &&
		entry.customType === PERSISTED_CANCELLED_TEXT_MARKER &&
		typeof entry.id === "string" &&
		isRecord(entry.data) &&
		entry.data.version === 1
	);
}

function hasVisibleCancelledText(message: AssistantMessage): boolean {
	return (
		message.stopReason === "aborted" &&
		message.content.length === 1 &&
		message.content[0]?.type === "text" &&
		message.content[0].text.length > 0
	);
}

function persistedVisibleAssistantText(message: Record<string, unknown>): string {
	const content = message.content;
	if (!Array.isArray(content) || content.length !== 1 || !isRecord(content[0])) return "";
	const part = content[0];
	return part.type === "text" && typeof part.text === "string" && Object.keys(part).length === 2
		? part.text
		: "";
}

function isCanonicalTerminalMessage(
	message: Record<string, unknown>,
	candidate: AssistantMessage,
): boolean {
	return isDeepStrictEqual(
		JSON.parse(JSON.stringify(message)),
		JSON.parse(JSON.stringify(candidate)),
	);
}

function createSafeTerminalMessage(
	message: Record<string, unknown>,
	terminalReason: AssistantTerminalReason,
	visibleAssistantText: string,
): AssistantMessage {
	return {
		role: "assistant",
		content:
			terminalReason === "aborted" && visibleAssistantText
				? [{ type: "text", text: visibleAssistantText }]
				: [],
		api: message.api as AssistantMessage["api"],
		provider: message.provider as AssistantMessage["provider"],
		model: typeof message.model === "string" ? message.model : "unknown",
		...(typeof message.responseModel === "string"
			? { responseModel: message.responseModel }
			: {}),
		usage: sanitizeUsage(message.usage),
		stopReason: terminalReason,
		errorMessage: getAssistantTerminalMessage(terminalReason),
		timestamp: finiteNumber(message.timestamp),
	};
}

function sanitizeUsage(value: unknown): AssistantMessage["usage"] {
	const usage = isRecord(value) ? value : {};
	const cost = isRecord(usage.cost) ? usage.cost : {};
	return {
		input: finiteNumber(usage.input),
		output: finiteNumber(usage.output),
		cacheRead: finiteNumber(usage.cacheRead),
		cacheWrite: finiteNumber(usage.cacheWrite),
		totalTokens: finiteNumber(usage.totalTokens),
		cost: {
			input: finiteNumber(cost.input),
			output: finiteNumber(cost.output),
			cacheRead: finiteNumber(cost.cacheRead),
			cacheWrite: finiteNumber(cost.cacheWrite),
			total: finiteNumber(cost.total),
		},
	};
}

function finiteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function rewriteSessionFileAtomically(filePath: string, content: string): Promise<void> {
	const tempPath = `${filePath}.terminal-sanitize.${process.pid}.${Math.random().toString(36).slice(2)}`;
	try {
		const handle = await open(tempPath, "w", 0o600);
		try {
			await handle.writeFile(content, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(tempPath, filePath);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => {});
		throw error;
	}
}

function overwriteAssistantMessage(
	target: AssistantMessage,
	replacement: AssistantMessage,
): void {
	const targetRecord = target as unknown as Record<string, unknown>;
	for (const key of Object.keys(targetRecord)) delete targetRecord[key];
	Object.assign(target, replacement);
}
