import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

export const MODEL_FAILURE_MESSAGE = "生成回复时发生错误，请重试";
export const MODEL_CANCELLED_MESSAGE = "生成已停止";

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
	if (message.stopReason === "error") {
		return replaceTerminalDiagnostics(message, MODEL_FAILURE_MESSAGE);
	}
	if (message.stopReason === "aborted") {
		return replaceTerminalDiagnostics(message, MODEL_CANCELLED_MESSAGE);
	}
	return message;
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
	terminalReason: "error" | "aborted" | null,
): void {
	const state = terminalPersistence.get(sessionManager);
	if (!state) return;
	const pendingMessage = state.pendingMessage;
	state.pendingMessage = null;
	if (!pendingMessage || !terminalReason) return;
	const finalMessage = terminalReason === pendingMessage.stopReason
		? pendingMessage
		: { ...pendingMessage, stopReason: terminalReason };
	state.appendMessage(sanitizeAssistantTerminalMessage(finalMessage));
}

function isTerminalAssistantMessage(
	message: PersistedMessage,
): message is AssistantMessage {
	return message.role === "assistant" && (
		message.stopReason === "error" || message.stopReason === "aborted"
	);
}

function replaceTerminalDiagnostics(
	message: AssistantMessage,
	errorMessage: string,
): AssistantMessage {
	const { diagnostics: _diagnostics, ...safeMessage } = message;
	return { ...safeMessage, errorMessage };
}
