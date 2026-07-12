export type ExportKind = "pdf" | "docx" | "pptx" | "xlsx" | "html";

const EXPORT_LABELS: Record<
	ExportKind,
	{ skillName: string; kindLabel: string; ext: string }
> = {
	pdf: { skillName: "pdf", kindLabel: "PDF", ext: "pdf" },
	docx: { skillName: "docx", kindLabel: "Word 文档", ext: "docx" },
	pptx: { skillName: "pptx", kindLabel: "PPT 演示文稿", ext: "pptx" },
	xlsx: { skillName: "xlsx", kindLabel: "Excel 表格", ext: "xlsx" },
	html: {
		skillName: "直接生成自包含 HTML",
		kindLabel: "HTML 页面",
		ext: "html",
	},
};

export function buildExportPrompt(kind: ExportKind, titleSource: string): string {
	const title = titleSource.trim().slice(0, 30) || "当前对话产出";
	const meta = EXPORT_LABELS[kind];
	const generator =
		kind === "html"
			? "直接生成一个自包含 HTML 文件，CSS/JS/图片资源尽量内嵌，不要依赖外部相对路径"
			: `用 ${meta.skillName} Skill 在 workspacePath 下生成主文件`;
	return [
		`请把当前对话整理产出为 ${meta.kindLabel}，按以下三步：`,
		"",
		`1. 调用 prepare_artifact(kind="${kind}", title="${title}", sourceSkill="${meta.skillName}") 获得 { id, workspacePath }`,
		`2. ${generator}，文件名建议 export-${Date.now()}.${meta.ext}`,
		`3. 调用 finalize_artifact(id, primaryFile="<生成的文件名>", sourceSkill="${meta.skillName}") 完成登记`,
		"",
		"完成后回复 artifact id 和大致内容摘要。",
	].join("\n");
}
