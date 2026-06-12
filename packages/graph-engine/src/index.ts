export * from "./types";
export * from "./model";
export * from "./render";
export * from "./select";
export * from "./sim";
export * from "./themes";

import type {
  GraphDiff,
  GraphEngine,
  GraphEngineOptions,
  Selection,
  SelectionInput,
  ThemeId
} from "./types";
import { createStaticGraphRenderer } from "./render";
import { resolveSelection } from "./select";

export function createGraphEngine(container: HTMLElement, options: GraphEngineOptions): GraphEngine {
  if (!container) {
    throw new Error("createGraphEngine requires a container element");
  }

  let currentTheme: ThemeId = options.theme;
  let destroyed = false;
  const renderer = createStaticGraphRenderer(container, {
    data: options.data,
    pins: options.pins || {},
    theme: currentTheme,
    onOpenPage: options.capabilities?.onOpenPage,
    onSelect: (input) => {
      options.capabilities?.onAsk?.(resolveSelection(options.data, input));
    },
    persistPins: options.capabilities?.persistPins
  });

  container.dataset.llmWikiGraphEngine = "mounted";
  container.dataset.llmWikiGraphTheme = currentTheme;

  return {
    async applyDiff(_diff: GraphDiff): Promise<void> {
      assertActive();
    },

    focusNode(path: string): void {
      assertActive();
      container.dataset.llmWikiGraphFocus = path;
      renderer.focusNode(path);
    },

    select(selector: SelectionInput): Selection {
      assertActive();
      renderer.select(selector);
      return resolveSelection(options.data, selector);
    },

    setTheme(theme: ThemeId): void {
      assertActive();
      currentTheme = theme;
      container.dataset.llmWikiGraphTheme = currentTheme;
      renderer.setTheme(theme);
    },

    resetLayout(): void {
      assertActive();
      renderer.resetLayout();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      renderer.destroy();
      delete container.dataset.llmWikiGraphEngine;
      delete container.dataset.llmWikiGraphTheme;
      delete container.dataset.llmWikiGraphFocus;
    }
  };

  function assertActive(): void {
    if (destroyed) {
      throw new Error("Graph engine has been destroyed");
    }
  }
}
