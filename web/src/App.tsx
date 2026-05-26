import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * 阶段一 step 3 - SSE echo 排练
 *
 * 这不是最终对话 UI，只是验证：
 *   - 前端 → 后端（通过 Vite proxy）
 *   - 后端 → 前端（SSE 流式 token）
 *   - 中文 / emoji 不被切坏
 *
 * 真正的对话 UI 在 step 4 接入 pi-agent SDK 后重写。
 */
function App() {
	const [input, setInput] = useState("你好，世界 🌍");
	const [tokens, setTokens] = useState<string[]>([]);
	const [status, setStatus] = useState<"idle" | "streaming" | "done" | "error">("idle");
	const [meta, setMeta] = useState<string>("");
	const sourceRef = useRef<EventSource | null>(null);

	const startStream = () => {
		sourceRef.current?.close();
		setTokens([]);
		setMeta("");
		setStatus("streaming");

		const url = `/api/stream-echo?text=${encodeURIComponent(input)}`;
		const es = new EventSource(url);
		sourceRef.current = es;

		es.addEventListener("token", (e) => {
			setTokens((prev) => [...prev, (e as MessageEvent).data]);
		});
		es.addEventListener("done", (e) => {
			setStatus("done");
			setMeta((e as MessageEvent).data);
			es.close();
		});
		es.addEventListener("error", () => {
			setStatus("error");
			es.close();
		});
	};

	const stopStream = () => {
		sourceRef.current?.close();
		setStatus("idle");
	};

	return (
		<div className="mx-auto max-w-3xl p-8">
			<header className="mb-6">
				<h1 className="text-2xl font-bold">llm-wiki-agent</h1>
				<p className="text-sm text-muted-foreground">阶段一 step 3 · SSE echo 排练</p>
			</header>

			<section className="mb-4 space-y-2">
				<label htmlFor="input" className="text-sm font-medium">
					输入文本
				</label>
				<textarea
					id="input"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					rows={3}
					className="w-full rounded-md border border-input bg-background p-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					placeholder="支持中文 / emoji，发送后逐字流式回显..."
				/>
			</section>

			<section className="mb-6 flex items-center gap-2">
				<Button onClick={startStream} disabled={status === "streaming" || !input}>
					{status === "streaming" ? "流式接收中..." : "发送"}
				</Button>
				{status === "streaming" && (
					<Button variant="outline" onClick={stopStream}>
						停止
					</Button>
				)}
				<span className="text-xs text-muted-foreground">状态：{status}</span>
			</section>

			<section className="rounded-md border border-input bg-card p-4">
				<div className="mb-2 text-xs text-muted-foreground">流式回显</div>
				<div className="min-h-[80px] whitespace-pre-wrap break-words font-mono text-sm">
					{tokens.join("")}
					{status === "streaming" && <span className="animate-pulse">▍</span>}
				</div>
				{meta && (
					<div className="mt-3 border-t pt-2 text-xs text-muted-foreground">完成事件 data: {meta}</div>
				)}
			</section>

			<footer className="mt-8 text-xs text-muted-foreground">
				后端：<code className="rounded bg-muted px-1.5 py-0.5">localhost:8787/api/stream-echo</code> ·
				通过 Vite proxy 转发
			</footer>
		</div>
	);
}

export default App;
