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

/** Creates a safe persisted copy without changing the live message used for retry decisions. */
export function sanitizeAssistantTerminalMessage(
	message: AssistantMessage,
): AssistantMessage {
	return sanitizeTerminalMessage(message, message.stopReason === "aborted");
}

function sanitizeTerminalMessage(
	message: AssistantMessage,
	preservePartialContent: boolean,
): AssistantMessage {
	const terminalReason = getAssistantTerminalReason(message.stopReason);
	return terminalReason
		? replaceTerminalDiagnostics(
			message,
			getAssistantTerminalMessage(terminalReason),
			preservePartialContent,
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

/** Commits only the final terminal fact after the SDK has finished retry or recovery work. */
export function finalizeSessionTerminalMessages(
	sessionManager: SessionManager,
	terminalReason: AssistantTerminalReason | null,
): void {
	const state = terminalPersistence.get(sessionManager);
	if (!state) return;
	const pendingMessage = state.pendingMessage;
	state.pendingMessage = null;
	if (!pendingMessage || !terminalReason) return;
	const finalMessage = terminalReason === pendingMessage.stopReason
		? pendingMessage
		: { ...pendingMessage, stopReason: terminalReason };
	state.appendMessage(
		sanitizeTerminalMessage(finalMessage, pendingMessage.stopReason === "aborted"),
	);
}

function isTerminalAssistantMessage(
	message: PersistedMessage,
): message is AssistantMessage {
	return message.role === "assistant" && getAssistantTerminalReason(message.stopReason) !== null;
}

function replaceTerminalDiagnostics(
	message: AssistantMessage,
	errorMessage: string,
	preservePartialContent: boolean,
): AssistantMessage {
	const { diagnostics: _diagnostics, ...safeMessage } = message;
	return {
		...safeMessage,
		...(preservePartialContent ? {} : { content: [] }),
		errorMessage,
	};
}
