import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { parseSSE } from "@/lib/sse";

/**
 * 阶段一 step 4 - 真 agent 对话
 *
 * 通过 fetch + ReadableStream 调 /api/prompt，解析 SSE 事件流：
 *   text_delta → 追加到当前 assistant 消息
 *   tool_start / tool_end → 内联显示工具调用
 *   done → 标记完成
 *   error → 红色错误条
 *
 * 这一步只支持单 session（后端缓存一个 in-memory session）。
 * 多知识库 / 多对话切换是 step 5+ 的事。
 */

type ToolMark = { name: string; status: "running" | "done" };

interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	tools: ToolMark[];
}

function newId() {
	return Math.random().toString(36).slice(2, 10);
}

function App() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const sendPrompt = async () => {
		const text = input.trim();
		if (!text || status === "streaming") return;

		setErrorMsg(null);
		setInput("");
		const userMsg: Message = { id: newId(), role: "user", content: text, tools: [] };
		const assistantId = newId();
		const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", tools: [] };
		setMessages((prev) => [...prev, userMsg, assistantMsg]);
		setStatus("streaming");

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const res = await fetch("/api/prompt", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: text }),
				signal: controller.signal,
			});

			if (!res.ok || !res.body) {
				throw new Error(`HTTP ${res.status} ${res.statusText}`);
			}

			for await (const { event, data } of parseSSE(res.body)) {
				if (event === "text_delta") {
					setMessages((prev) =>
						prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + data } : m)),
					);
				} else if (event === "tool_start") {
					const payload = JSON.parse(data) as { toolName: string; toolCallId: string };
					setMessages((prev) =>
						prev.map((m) =>
							m.id === assistantId
								? { ...m, tools: [...m.tools, { name: payload.toolName, status: "running" }] }
								: m,
						),
					);
				} else if (event === "tool_end") {
					const payload = JSON.parse(data) as { toolName: string };
					setMessages((prev) =>
						prev.map((m) => {
							if (m.id !== assistantId) return m;
							// 把同名工具的最后一个 running 标记成 done
							const tools = [...m.tools];
							for (let i = tools.length - 1; i >= 0; i--) {
								if (tools[i].name === payload.toolName && tools[i].status === "running") {
									tools[i] = { ...tools[i], status: "done" };
									break;
								}
							}
							return { ...m, tools };
						}),
					);
				} else if (event === "done") {
					setStatus("idle");
				} else if (event === "error") {
					const payload = JSON.parse(data) as { message: string; hint?: string };
					setErrorMsg(payload.message + (payload.hint ? `\n提示：${payload.hint}` : ""));
					setStatus("error");
				}
			}
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				setStatus("idle");
				return;
			}
			setErrorMsg(err instanceof Error ? err.message : String(err));
			setStatus("error");
		} finally {
			abortRef.current = null;
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		// Cmd/Ctrl + Enter 发送
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			sendPrompt();
		}
	};

	const handleReset = async () => {
		abortRef.current?.abort();
		await fetch("/api/reset", { method: "POST" }).catch(() => {});
		setMessages([]);
		setErrorMsg(null);
		setStatus("idle");
	};

	return (
		<div className="mx-auto flex h-screen max-w-3xl flex-col p-6">
			<header className="mb-4 flex items-center justify-between">
				<div>
					<h1 className="text-xl font-bold">llm-wiki-agent</h1>
					<p className="text-xs text-muted-foreground">阶段一 step 4 · agent 接入</p>
				</div>
				<Button variant="outline" size="sm" onClick={handleReset} disabled={status === "streaming"}>
					新对话
				</Button>
			</header>

			<section className="flex-1 space-y-4 overflow-y-auto rounded-md border border-input bg-card p-4">
				{messages.length === 0 && (
					<div className="text-sm text-muted-foreground">
						试试问：<code className="rounded bg-muted px-1.5 py-0.5">列出当前目录的文件</code>
					</div>
				)}
				{messages.map((m) => (
					<MessageBubble key={m.id} message={m} />
				))}
				{status === "streaming" &&
					messages[messages.length - 1]?.content === "" &&
					messages[messages.length - 1]?.tools.length === 0 && (
						<div className="text-xs text-muted-foreground italic">等待 agent 响应…</div>
					)}
			</section>

			{errorMsg && (
				<div className="mt-3 whitespace-pre-wrap rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
					{errorMsg}
				</div>
			)}

			<section className="mt-4">
				<textarea
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					rows={3}
					className="w-full rounded-md border border-input bg-background p-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					placeholder="输入消息… Cmd/Ctrl + Enter 发送"
					disabled={status === "streaming"}
				/>
				<div className="mt-2 flex items-center justify-between">
					<span className="text-xs text-muted-foreground">状态：{status}</span>
					<Button onClick={sendPrompt} disabled={status === "streaming" || !input.trim()}>
						{status === "streaming" ? "等待中…" : "发送"}
					</Button>
				</div>
			</section>
		</div>
	);
}

function MessageBubble({ message }: { message: Message }) {
	const isUser = message.role === "user";
	return (
		<div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
			<div
				className={`max-w-[85%] rounded-lg px-4 py-2 text-sm ${
					isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
				}`}
			>
				<div className="mb-1 text-xs opacity-60">{isUser ? "你" : "assistant"}</div>
				{message.tools.length > 0 && (
					<div className="mb-2 space-y-0.5">
						{message.tools.map((t, i) => (
							<div key={i} className="font-mono text-xs opacity-80">
								{t.status === "running" ? "▶" : "✓"} {t.name}
							</div>
						))}
					</div>
				)}
				<div className="whitespace-pre-wrap break-words">{message.content || (message.role === "assistant" ? "…" : "")}</div>
			</div>
		</div>
	);
}

export default App;
