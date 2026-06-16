import type {
  GraphDiff,
  GraphEngine,
  GraphEngineOptions,
  GraphData,
  Selection,
  SelectionInput,
  ThemeId
} from "./types";
import { createStaticGraphRenderer } from "./render";
import { resolveSelectionForCapabilities } from "./select";

export type GraphFacadeHostMode = "workbench" | "offline" | "standalone";

export interface GraphFacadeCapabilityContract {
  mode: GraphFacadeHostMode;
  capabilities: GraphEngineOptions["capabilities"];
}

export function createGraphWorkbenchCapabilities(
  capabilities: NonNullable<GraphEngineOptions["capabilities"]>
): GraphFacadeCapabilityContract {
  return {
    mode: "workbench",
    capabilities: {
      onOpenPage: capabilities.onOpenPage,
      onSelectionChange: capabilities.onSelectionChange,
      onSelectionClear: capabilities.onSelectionClear,
      onAsk: capabilities.onAsk,
      persistPins: capabilities.persistPins,
      onDragStateChange: capabilities.onDragStateChange
    }
  };
}

export function createGraphOfflineCapabilities(
  capabilities: Pick<NonNullable<GraphEngineOptions["capabilities"]>, "persistPins"> = {}
): GraphFacadeCapabilityContract {
  return {
    mode: "offline",
    capabilities: {
      persistPins: capabilities.persistPins
    }
  };
}

export function createGraphStandaloneCapabilities(): GraphFacadeCapabilityContract {
  return {
    mode: "standalone",
    capabilities: undefined
  };
}

export interface GraphFacadeRenderer {
  applyDiff(diff: GraphDiff, options?: { reducedMotion?: boolean; durationMs?: number }): Promise<void>;
  isDragging(): boolean;
  setData(data: GraphEngineOptions["data"], pins?: GraphEngineOptions["pins"]): void;
  focusNode(path: string): void;
  focusCommunity(id: string): void;
  setTypeFilters(filters: NonNullable<GraphEngineOptions["typeFilters"]>): void;
  resetView(): void;
  select(selection: SelectionInput): void;
  clearSelection(): void;
  clearInteraction(): void;
  setTheme(theme: ThemeId): void;
  setPins(pins: NonNullable<GraphEngineOptions["pins"]>): void;
  resetLayout(): void;
  destroy(): void;
}

interface GraphFacadeContainer {
  dataset: Record<string, string | undefined>;
}

interface GraphFacadeState {
  data: GraphData;
}

export function createGraphFacade(container: HTMLElement, options: GraphEngineOptions): GraphEngine {
  if (!container) {
    throw new Error("createGraphEngine requires a container element");
  }

  const capabilities = options.capabilities;
  const facadeState: GraphFacadeState = { data: options.data };
  const renderer = createStaticGraphRenderer(container, {
    data: options.data,
    pins: options.pins || {},
    theme: options.theme,
    toolbarContainer: options.toolbarContainer,
    focus: options.focus,
    typeFilters: options.typeFilters,
    onOpenPage: capabilities?.onOpenPage,
    onSelectionChange: shouldResolveSelection(capabilities)
      ? (input) => {
          const selection = resolveSelectionForCapabilities(facadeState.data, input, {
            canAsk: Boolean(capabilities?.onAsk)
          });
          capabilities?.onSelectionChange?.(selection);
          if (!capabilities?.onSelectionChange) capabilities?.onAsk?.(selection);
        }
      : undefined,
    persistPins: capabilities?.persistPins,
    onSelectionClear: capabilities?.onSelectionClear,
    onDragStateChange: capabilities?.onDragStateChange
  });

  return createGraphFacadeFromRenderer(container, renderer, options, facadeState);
}

export function createGraphFacadeFromRenderer(
  container: GraphFacadeContainer,
  renderer: GraphFacadeRenderer,
  options: GraphEngineOptions,
  facadeState: GraphFacadeState = { data: options.data }
): GraphEngine {
  let currentTheme: ThemeId = options.theme;
  let destroyed = false;
  const canAsk = Boolean(options.capabilities?.onAsk);
  const resolveForHostCapabilities = (input: SelectionInput): Selection =>
    resolveSelectionForCapabilities(facadeState.data, input, { canAsk });

  container.dataset.llmWikiGraphEngine = "mounted";
  container.dataset.llmWikiGraphTheme = currentTheme;

  return {
    async applyDiff(diff: GraphDiff, animationOptions?: { reducedMotion?: boolean; durationMs?: number }): Promise<void> {
      assertActive();
      await renderer.applyDiff(diff, animationOptions);
    },

    isDragging(): boolean {
      assertActive();
      return renderer.isDragging();
    },

    setData(data, pins): void {
      assertActive();
      facadeState.data = data;
      renderer.setData(data, pins);
    },

    focusNode(path: string): void {
      assertActive();
      container.dataset.llmWikiGraphFocus = path;
      renderer.focusNode(path);
    },

    focusCommunity(id): Selection {
      assertActive();
      container.dataset.llmWikiGraphFocus = `community:${id}`;
      renderer.focusCommunity(id);
      return resolveForHostCapabilities({ kind: "community", id });
    },

    setTypeFilters(filters): void {
      assertActive();
      renderer.setTypeFilters(filters);
    },

    resetView(): void {
      assertActive();
      delete container.dataset.llmWikiGraphFocus;
      renderer.resetView();
    },

    select(selector: SelectionInput): Selection {
      assertActive();
      renderer.select(selector);
      return resolveForHostCapabilities(selector);
    },

    clearSelection(): void {
      assertActive();
      renderer.clearSelection();
    },

    clearInteraction(): void {
      assertActive();
      renderer.clearInteraction();
      delete container.dataset.llmWikiGraphFocus;
    },

    setTheme(theme: ThemeId): void {
      assertActive();
      currentTheme = theme;
      container.dataset.llmWikiGraphTheme = currentTheme;
      renderer.setTheme(theme);
    },

    setPins(pins): void {
      assertActive();
      renderer.setPins(pins);
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

function shouldResolveSelection(capabilities: GraphEngineOptions["capabilities"]): boolean {
  return Boolean(capabilities?.onSelectionChange || capabilities?.onAsk);
}
