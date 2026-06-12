import type { ThemeId } from "../types";

export interface ThemeTokens {
  id: ThemeId;
  colorScheme: "light" | "dark";
  vars: Record<string, string>;
  communityColors: string[];
}

const SHAN_SHUI_ROOT = `
  color-scheme: light;
  --bg: #f4efe4;
  --surface: #fffdf7;
  --surface-2: #f8f1e4;
  --vellum: #e9ddc9;
  --mist: #ece5d8;
  --ink: #241f1a;
  --muted: #6f6559;
  --faint: #9b8f7e;
  --rule: #d8cdbb;
  --line: #cfc4b1;
  --cinnabar: #8b2e24;
  --cinnabar-2: #a23b2a;
  --jade: #4b7564;
  --green: #3e6b4b;
  --night: #315f72;
  --amber: #b7791f;
  --violet: #6f557f;
  --shadow: 0 18px 36px rgba(36, 31, 26, .11);
  --soft-shadow: 0 10px 24px rgba(36, 31, 26, .08);
  --radius: 12px;
  --font-serif: "Noto Serif SC", "Songti SC", "STSong", Georgia, serif;
  --font-ui: "Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
`;

const MO_YE_ROOT = `
  color-scheme: dark;
  --bg: #11100e;
  --surface: #1b1a17;
  --surface-2: #24221e;
  --vellum: #343028;
  --mist: #292723;
  --ink: #f3eee3;
  --muted: #b9ae9e;
  --faint: #887f72;
  --rule: #403b33;
  --line: #5a5247;
  --cinnabar: #d65a46;
  --cinnabar-2: #ef7058;
  --jade: #78a891;
  --green: #78a06e;
  --night: #79a9bd;
  --amber: #d6a34b;
  --violet: #b397c9;
  --shadow: 0 18px 36px rgba(0, 0, 0, .34);
  --soft-shadow: 0 10px 24px rgba(0, 0, 0, .24);
  --radius: 12px;
  --font-serif: "Noto Serif SC", "Songti SC", "STSong", Georgia, serif;
  --font-ui: "Noto Sans SC", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
`;

export function parseCssTokens(cssText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawDeclaration of cssText.split(";")) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const separatorIndex = declaration.indexOf(":");
    if (separatorIndex < 1) continue;
    const key = declaration.slice(0, separatorIndex).trim();
    const value = declaration.slice(separatorIndex + 1).trim();
    if (!key.startsWith("--") || !value) continue;
    out[key] = value;
  }
  return out;
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  "shan-shui": {
    id: "shan-shui",
    colorScheme: "light",
    vars: parseCssTokens(SHAN_SHUI_ROOT),
    communityColors: ["#8b2e24", "#315f72", "#4b7564", "#b7791f", "#6f557f", "#3e6b4b", "#9b6a36", "#5d6f91"]
  },
  "mo-ye": {
    id: "mo-ye",
    colorScheme: "dark",
    vars: parseCssTokens(MO_YE_ROOT),
    communityColors: ["#d65a46", "#79a9bd", "#78a891", "#d6a34b", "#b397c9", "#78a06e", "#c29061", "#9aa8d8"]
  }
};

export function getThemeTokens(theme: ThemeId): ThemeTokens {
  return THEMES[theme] || THEMES["shan-shui"];
}

export function themeTokensToCssVars(theme: ThemeId | ThemeTokens): Record<string, string> {
  const tokens = typeof theme === "string" ? getThemeTokens(theme) : theme;
  return { ...tokens.vars };
}

export function getCommunityColor(theme: ThemeId | ThemeTokens, index: number): string {
  const tokens = typeof theme === "string" ? getThemeTokens(theme) : theme;
  const palette = tokens.communityColors.length ? tokens.communityColors : THEMES["shan-shui"].communityColors;
  return palette[Math.abs(Math.trunc(index)) % palette.length];
}
