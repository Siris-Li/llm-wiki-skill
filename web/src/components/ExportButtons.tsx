import { FileDown, FileText, Globe, Presentation, Table } from "lucide-react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ExportKind } from "@/lib/api";

const EXPORTS: Array<{
	kind: ExportKind;
	label: string;
	icon: ComponentType<{ className?: string }>;
}> = [
	{ kind: "pdf", label: "PDF", icon: FileDown },
	{ kind: "docx", label: "Word", icon: FileText },
	{ kind: "pptx", label: "PPT", icon: Presentation },
	{ kind: "xlsx", label: "Excel", icon: Table },
	{ kind: "html", label: "HTML", icon: Globe },
];

interface Props {
	disabled: boolean;
	disabledReason: string;
	onExport: (kind: ExportKind) => void;
}

export function ExportButtons({ disabled, disabledReason, onExport }: Props) {
	return (
		<div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2">
			<span className="mr-1 text-xs text-muted-foreground">导出</span>
			{EXPORTS.map((item) => {
				const Icon = item.icon;
				return (
					<Tooltip key={item.kind}>
						<TooltipTrigger asChild>
							<span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={disabled}
									onClick={() => onExport(item.kind)}
									className="h-8 gap-1.5 px-2.5 text-xs disabled:opacity-45"
								>
									<Icon className="size-3.5" />
									{item.label}
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent side="top">
							{disabled ? disabledReason : `导出为 ${item.label}`}
						</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}
