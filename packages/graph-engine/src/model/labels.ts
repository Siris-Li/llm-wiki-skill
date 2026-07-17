const LABEL_CJK_WIDTH = 15;
const LABEL_LATIN_WIDTH = 8.5;
const LABEL_PADDING = 22;
const LABEL_MIN_WIDTH = 72;
const LABEL_MAX_WIDTH = 180;
const LABEL_ELLIPSIS = "…";
const LABEL_ELLIPSIS_WIDTH = 8;

const labelSegmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("zh", { granularity: "grapheme" })
  : null;

const ATLAS_CONFIDENCE_LABELS = {
  EXTRACTED: "直接提取",
  INFERRED: "推断关联",
  AMBIGUOUS: "存在歧义",
  UNVERIFIED: "未核实"
} as const;

const ATLAS_TYPE_LABELS = {
  topic: "主题",
  entity: "实体",
  source: "来源",
  comparison: "对比",
  synthesis: "综合",
  query: "查询"
} as const;

const ATLAS_TYPE_KINDS = {
  topic: "TOPIC",
  entity: "ENTITY",
  source: "SOURCE",
  comparison: "COMPARISON",
  synthesis: "SYNTHESIS",
  query: "QUERY"
} as const;

type AtlasConfidenceKey = keyof typeof ATLAS_CONFIDENCE_LABELS;
type AtlasTypeKey = keyof typeof ATLAS_TYPE_LABELS;

interface TruncatedLabel {
  text: string;
  truncated: boolean;
}

interface LabelCardNode {
  id: string;
  label?: string | null;
  type?: string | null;
}

interface LabelCardDimensions {
  w: number;
  h: number;
}

function isVariationSelector(grapheme: string): boolean {
  const code = grapheme.codePointAt(0);
  return code !== undefined && code >= 0xfe00 && code <= 0xfe0f;
}

function isCombiningMark(grapheme: string): boolean {
  const code = grapheme.codePointAt(0);
  return code !== undefined && (
    (code >= 0x0300 && code <= 0x036f)
    || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff)
    || (code >= 0x20d0 && code <= 0x20ff)
    || (code >= 0xfe20 && code <= 0xfe2f)
  );
}

function isEmojiModifier(grapheme: string): boolean {
  const code = grapheme.codePointAt(0);
  return code !== undefined && code >= 0x1f3fb && code <= 0x1f3ff;
}

export function splitLabelGraphemes(label: string): string[] {
  if (labelSegmenter) {
    return Array.from(labelSegmenter.segment(label), (segment) => segment.segment);
  }

  const parts = Array.from(label);
  if (!parts.length) return [];

  const graphemes = [parts[0]];
  for (let index = 1; index < parts.length; index += 1) {
    const current = parts[index];
    const previous = parts[index - 1];
    if (
      current === "‍"
      || previous === "‍"
      || isVariationSelector(current)
      || isCombiningMark(current)
      || isEmojiModifier(current)
    ) {
      graphemes[graphemes.length - 1] += current;
    } else {
      graphemes.push(current);
    }
  }
  return graphemes;
}

export function labelCharWidth(grapheme: string): number {
  return /[一-鿿]/.test(grapheme) ? LABEL_CJK_WIDTH : LABEL_LATIN_WIDTH;
}

export function measureLabelWidth(graphemes: readonly string[]): number {
  let width = 0;
  for (const grapheme of graphemes) width += labelCharWidth(grapheme);
  return width;
}

export function truncateLabel(label: unknown, maxWidth: number): TruncatedLabel {
  if (!label || typeof label !== "string") return { text: "", truncated: false };

  const graphemes = splitLabelGraphemes(label);
  if (measureLabelWidth(graphemes) + LABEL_PADDING <= maxWidth) {
    return { text: label, truncated: false };
  }

  let text = "";
  let width = 0;
  for (const grapheme of graphemes) {
    const graphemeWidth = labelCharWidth(grapheme);
    if (width + graphemeWidth + LABEL_ELLIPSIS_WIDTH + LABEL_PADDING > maxWidth) break;
    text += grapheme;
    width += graphemeWidth;
  }
  return { text: `${text}${LABEL_ELLIPSIS}`, truncated: true };
}

export function cardDims(node: LabelCardNode): LabelCardDimensions {
  const label = node.label || node.id;
  const widthByLabel = measureLabelWidth(splitLabelGraphemes(label));
  let width = Math.max(LABEL_MIN_WIDTH, Math.min(LABEL_MAX_WIDTH, widthByLabel + LABEL_PADDING));
  let height = 36;
  if (node.type === "topic") {
    height = 40;
    width += 6;
  }
  if (node.type === "source") height = 32;
  return { w: width, h: height };
}

export function stripAtlasMarkdown(raw: unknown): string {
  return String(raw || "")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, target: string, label: string) => label || target)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function atlasConfidenceLabel(confidence: unknown): string {
  const normalized = normalizeAtlasConfidence(confidence);
  return ATLAS_CONFIDENCE_LABELS[normalized];
}

export function atlasTypeLabel(type: unknown): string {
  const normalized = normalizeAtlasType(type);
  return ATLAS_TYPE_LABELS[normalized];
}

export function atlasNodeKind(type: unknown): string {
  const normalized = normalizeAtlasType(type);
  return ATLAS_TYPE_KINDS[normalized];
}

function normalizeAtlasConfidence(confidence: unknown): AtlasConfidenceKey {
  const normalized = String(confidence || "EXTRACTED").toUpperCase();
  return normalized in ATLAS_CONFIDENCE_LABELS ? normalized as AtlasConfidenceKey : "EXTRACTED";
}

function normalizeAtlasType(type: unknown): AtlasTypeKey {
  const normalized = String(type || "entity").toLowerCase();
  return normalized in ATLAS_TYPE_LABELS ? normalized as AtlasTypeKey : "entity";
}
