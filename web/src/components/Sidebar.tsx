import { useState } from "react";

import { AddExternalDialog } from "@/components/AddExternalDialog";
import { NewWikiDialog } from "@/components/NewWikiDialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ConversationInfo, KnowledgeBaseInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
	knowledgeBases: KnowledgeBaseInfo[];
	currentKbPath: string | null;
	conversations: ConversationInfo[];
	currentConversationId: string | null;
	loading: boolean;
	error: string | null;
	onSelectKb: (item: KnowledgeBaseInfo) => void;
	onSelectConversation: (item: ConversationInfo) => void;
	onNewConversation: () => void;
	onRefresh: () => void;
	onAddExternal: (path: string) => Promise<void>;
	onCreateWiki: (name: string, purpose: string) => Promise<void>;
	onStartBatchDigest?: (input: {
		kbPath: string;
		filePaths: string[];
		sourceRoot?: string;
		concurrency: 1 | 3 | 5;
	}) => void;
}

export function Sidebar({
	knowledgeBases,
	currentKbPath,
	conversations,
	currentConversationId,
	loading,
	error,
	onSelectKb,
	onSelectConversation,
	onNewConversation,
	onRefresh,
	onAddExternal,
	onCreateWiki,
	onStartBatchDigest,
}: Props) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [newWikiOpen, setNewWikiOpen] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const currentExpanded = currentKbPath ? expanded.has(currentKbPath) : false;
	const toggleExpanded = (path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	return (
		<aside className="flex h-full w-60 flex-col border-r border-input bg-muted/30">
			<div className="flex items-center justify-between border-b border-input px-4 py-3">
				<h2 className="text-sm font-semibold">llm-wiki-agent</h2>
				<Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} title="刷新">
					{loading ? "…" : "↻"}
				</Button>
			</div>

			<div className="flex-1 space-y-4 overflow-y-auto px-2 py-3 text-sm">
				{error && (
					<div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
						{error}
					</div>
				)}

				<Section title="知识库" hint="~/llm-wiki/ + 外部">
					{knowledgeBases.length === 0 ? (
						<EmptyHint text="还没有知识库" />
					) : (
						knowledgeBases.map((item) => {
							const active = item.path === currentKbPath;
							const opened = active && currentExpanded;
							return (
								<div key={item.path}>
									<KbItem
										item={item}
										active={active}
										expanded={opened}
										onClick={() => {
											onSelectKb(item);
											if (item.valid && !expanded.has(item.path)) {
												setExpanded((prev) => new Set(prev).add(item.path));
											}
										}}
										onToggle={() => toggleExpanded(item.path)}
									/>
									{opened && (
										<div className="ml-5 mt-1 space-y-1 border-l border-input/60 pl-2">
											<button
												type="button"
												onClick={onNewConversation}
												className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
											>
												+ 新对话
											</button>
											{conversations.length === 0 ? (
												<EmptyHint text="暂无对话" />
											) : (
												conversations.map((c) => (
													<ConversationItem
														key={c.id}
														item={c}
														active={c.id === currentConversationId}
														onClick={() => onSelectConversation(c)}
													/>
												))
											)}
										</div>
									)}
								</div>
							);
						})
					)}
				</Section>
			</div>

			<div className="space-y-2 border-t border-input p-2">
				<Button
					variant="default"
					size="sm"
					className="w-full"
					onClick={() => setNewWikiOpen(true)}
				>
					+ 新建知识库
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="w-full"
					onClick={() => setDialogOpen(true)}
				>
					+ 添加现有库
				</Button>
			</div>

			<NewWikiDialog
				open={newWikiOpen}
				onOpenChange={setNewWikiOpen}
				onSubmit={onCreateWiki}
			/>
			<AddExternalDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSubmit={onAddExternal}
				onStartBatchDigest={onStartBatchDigest}
			/>
		</aside>
	);
}

function Section({
	title,
	hint,
	action,
	children,
}: {
	title: string;
	hint?: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="mb-1 flex items-baseline justify-between px-2">
				<span className="text-xs font-medium text-muted-foreground">
					{title}
					{hint && <span className="ml-1 text-[10px] opacity-60">{hint}</span>}
				</span>
				{action}
			</div>
			<div className="space-y-0.5">{children}</div>
		</div>
	);
}

function EmptyHint({ text }: { text: string }) {
	return <div className="px-2 py-1 text-xs italic text-muted-foreground">{text}</div>;
}

function KbItem({
	item,
	active,
	expanded,
	onClick,
	onToggle,
}: {
	item: KnowledgeBaseInfo;
	active: boolean;
	expanded: boolean;
	onClick: () => void;
	onToggle: () => void;
}) {
	const isDisabled = !item.valid;

	const inner = (
		<div className="flex items-center gap-1">
			<button
				type="button"
				onClick={onToggle}
				disabled={isDisabled || !active}
				className="h-7 w-6 rounded-md text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
				aria-label="展开对话"
			>
				{expanded ? "▾" : "▸"}
			</button>
			<button
				type="button"
				onClick={onClick}
				disabled={isDisabled}
				className={cn(
					"min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
					"hover:bg-accent hover:text-accent-foreground",
					"disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
					active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
				)}
				title={item.path}
			>
				<span className="mr-1.5">{active ? "●" : "○"}</span>
				<span className="truncate">{item.name}</span>
				{item.origin === "external" && (
					<span className="ml-1 text-[10px] opacity-70">外部</span>
				)}
			</button>
		</div>
	);

	if (!item.valid && item.reason) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div>{inner}</div>
				</TooltipTrigger>
				<TooltipContent side="right">
					<div className="text-xs">{item.reason}</div>
					<div className="mt-1 text-[10px] opacity-70">{item.path}</div>
				</TooltipContent>
			</Tooltip>
		);
	}

	return inner;
}

function ConversationItem({
	item,
	active,
	onClick,
}: {
	item: ConversationInfo;
	active: boolean;
	onClick: () => void;
}) {
	const time = item.modifiedAt ? new Date(item.modifiedAt) : null;
	const timeLabel = time ? `${time.getMonth() + 1}/${time.getDate()} ${pad(time.getHours())}:${pad(time.getMinutes())}` : "";
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
				"hover:bg-accent hover:text-accent-foreground",
				active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
			)}
			title={item.firstMessage}
		>
			<div className="truncate">{item.firstMessage || "（无消息）"}</div>
			{timeLabel && <div className="text-[10px] opacity-60">{timeLabel}</div>}
		</button>
	);
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}
