export class RecoverableSseProtocolError extends Error {
	readonly recoverable = true;
}

interface SseLifecycleOptions {
	schemaVersion: number;
	eventTypes: readonly string[];
	identityFields: readonly string[];
	terminalEventTypes?: readonly string[];
	requireTerminal?: boolean;
	requiredFirstEventType?: string;
	eventName?: "matches-type" | string;
	error: (message: string) => RecoverableSseProtocolError;
}

export class SseLifecycleGuard {
	private readonly options: SseLifecycleOptions;
	private readonly eventTypes: ReadonlySet<string>;
	private readonly terminalEventTypes: ReadonlySet<string>;
	private expectedSeq = 1;
	private identity: Record<string, string> | null = null;
	private terminalSeen = false;
	private eventCount = 0;

	constructor(options: SseLifecycleOptions) {
		this.options = options;
		this.eventTypes = new Set(options.eventTypes);
		this.terminalEventTypes = new Set(options.terminalEventTypes ?? []);
	}

	accept(value: unknown, eventName: string): Record<string, unknown> {
		if (this.terminalSeen) throw this.options.error("流在结束事件后仍包含事件");
		if (!isRecord(value)) throw this.options.error("事件必须是 JSON 对象");
		if (value.schemaVersion !== this.options.schemaVersion) {
			throw this.options.error("事件 schemaVersion 不受支持");
		}
		if (typeof value.type !== "string" || !this.eventTypes.has(value.type)) {
			throw this.options.error("流包含未知事件类型");
		}
		if (this.options.eventName === "matches-type" && eventName !== value.type) {
			throw this.options.error("SSE 事件名称与 data.type 不一致");
		}
		if (
			this.options.eventName &&
			this.options.eventName !== "matches-type" &&
			eventName !== this.options.eventName
		) {
			throw this.options.error("SSE 事件通道不符合契约");
		}
		if (!Number.isInteger(value.seq) || (value.seq as number) < 1) {
			throw this.options.error("事件 seq 无效");
		}
		if (value.seq !== this.expectedSeq) {
			throw this.options.error(`事件序号不连续：期待 ${this.expectedSeq}，收到 ${String(value.seq)}`);
		}

		const nextIdentity: Record<string, string> = {};
		for (const field of this.options.identityFields) {
			const fieldValue = value[field];
			if (typeof fieldValue !== "string" || fieldValue.length === 0) {
				throw this.options.error(`事件缺少 ${field}`);
			}
			nextIdentity[field] = fieldValue;
		}
		if (this.identity === null) {
			this.identity = nextIdentity;
		} else if (
			this.options.identityFields.some((field) => this.identity?.[field] !== nextIdentity[field])
		) {
			throw this.options.error("同一流中的事件身份发生变化");
		}

		if (
			this.eventCount === 0 &&
			this.options.requiredFirstEventType &&
			value.type !== this.options.requiredFirstEventType
		) {
			throw this.options.error("流缺少规定的首个握手事件");
		}

		this.eventCount += 1;
		this.expectedSeq += 1;
		this.terminalSeen = this.terminalEventTypes.has(value.type);
		return value;
	}

	finish(): void {
		if (this.options.requireTerminal && !this.terminalSeen) {
			throw this.options.error("流提前结束，缺少结束事件");
		}
	}
}

export function parseSseJson(
	data: string,
	error: (message: string) => RecoverableSseProtocolError,
): unknown {
	try {
		return JSON.parse(data);
	} catch {
		throw error("流包含无法解析的事件数据");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
