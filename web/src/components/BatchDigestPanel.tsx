import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BatchDigestEvent } from "@/lib/api";

export interface BatchDigestJob {
	id: string;
	status: "running" | "done" | "error";
	total: number;
	completed: number;
	failed: number;
	current?: string;
	outputDir?: string;
	error?: string;
	events: BatchDigestEvent[];
}

interface Props {
	job: BatchDigestJob | null;
	onClose: () => void;
}

export function BatchDigestPanel({ job, onClose }: Props) {
	if (!job) return null;
	const percent = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;
	return (
		<div className="fixed bottom-4 right-4 z-40 w-80 rounded-md border border-input bg-background p-3 shadow-lg">
			<div className="mb-2 flex items-start justify-between gap-3">
				<div>
					<div className="text-sm font-medium">批量消化</div>
					<div className="text-xs text-muted-foreground">
						{job.completed} 完成 / {job.failed} 失败 / {job.total} 总数
					</div>
				</div>
				<Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
					<X className="size-4" />
				</Button>
			</div>
			<div className="h-2 overflow-hidden rounded-full bg-muted">
				<div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
			</div>
			{job.current && (
				<div className="mt-2 truncate text-xs text-muted-foreground">{job.current}</div>
			)}
			{job.status === "done" && (
				<div className="mt-2 text-xs text-emerald-400">已完成：{job.outputDir}</div>
			)}
			{job.status === "error" && (
				<div className="mt-2 text-xs text-destructive">{job.error}</div>
			)}
		</div>
	);
}
