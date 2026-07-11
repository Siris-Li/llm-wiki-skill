export function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: new DOMException("aborted", "AbortError");
}

export function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === "AbortError";
}
