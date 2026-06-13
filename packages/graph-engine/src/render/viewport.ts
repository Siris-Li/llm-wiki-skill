export interface RendererViewport {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_RENDERER_VIEWPORT: RendererViewport = {
  x: 0,
  y: 0,
  scale: 1
};

export function normalizeRendererViewport(viewport: Partial<RendererViewport> | null | undefined): RendererViewport {
  return {
    x: finiteNumber(viewport?.x, DEFAULT_RENDERER_VIEWPORT.x),
    y: finiteNumber(viewport?.y, DEFAULT_RENDERER_VIEWPORT.y),
    scale: Math.max(0.01, finiteNumber(viewport?.scale, DEFAULT_RENDERER_VIEWPORT.scale))
  };
}

export function rendererViewportToTransform(viewport: Partial<RendererViewport> | null | undefined): string {
  const safe = normalizeRendererViewport(viewport);
  return `translate(${round(safe.x)}px, ${round(safe.y)}px) scale(${round(safe.scale)})`;
}

export function applyRendererViewportTransform(layer: HTMLElement, viewport: Partial<RendererViewport> | null | undefined): void {
  const safe = normalizeRendererViewport(viewport);
  layer.style.transformOrigin = "0 0";
  layer.style.transform = rendererViewportToTransform(safe);
  layer.dataset.viewportX = String(round(safe.x));
  layer.dataset.viewportY = String(round(safe.y));
  layer.dataset.viewportScale = String(round(safe.scale));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
