import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bindSigmaWheelZoomController,
  sigmaViewportCenter,
  sigmaWheelInputFromPayload
} from "../src/render/sigma-wheel-zoom";
import { SIGMA_CAMERA_MAX_RATIO, sigmaWheelZoomRatio } from "../src/render/sigma-zoom";

describe("Sigma wheel zoom controller", () => {
  it("owns one capture-phase wheel listener on the route root and removes it on destroy", () => {
    const eventRoot = fakeWheelRoot();
    const controller = bindController({ eventRoot });

    assert.equal(eventRoot.onCalls.length, 1);
    assert.deepEqual(eventRoot.onCalls[0]?.options, { capture: true, passive: false });

    controller.destroy();

    assert.equal(eventRoot.offCalls.length, 1);
    assert.equal(eventRoot.offCalls[0]?.listener, eventRoot.onCalls[0]?.listener);
    assert.equal(eventRoot.offCalls[0]?.options, true);
  });

  it("zooms once from an interactive community overlay before the event reaches Sigma canvas", () => {
    const eventRoot = fakeWheelRoot();
    const points: Array<{ point: { x: number; y: number }; ratio: number }> = [];
    bindController({
      eventRoot,
      viewportRoot: rootWithRect(10, 20, 200, 100),
      currentRatio: () => 1.2,
      onZoomAtPoint: (point, ratio) => points.push({ point, ratio })
    });
    const wheel = wheelEvent(overlayTarget(), {
      clientX: 55,
      clientY: 66,
      deltaY: 120,
      deltaMode: 0,
      ctrlKey: true
    });

    eventRoot.emit(wheel);

    assert.equal(wheel.defaultPrevented, true);
    assert.equal(wheel.propagationStopped, true);
    assert.deepEqual(points, [{
      point: { x: 45, y: 46 },
      ratio: sigmaWheelZoomRatio(1.2, { deltaY: 120, deltaMode: 0 })
    }]);
  });

  it("blocks pinch zoom over graph controls while preserving ordinary control scrolling", () => {
    const eventRoot = fakeWheelRoot();
    let zoomCalls = 0;
    bindController({ eventRoot, onZoomAtPoint: () => { zoomCalls += 1; } });

    const pinch = wheelEvent(controlTarget(".graph-search"), { deltaY: -40, ctrlKey: true });
    eventRoot.emit(pinch);
    assert.equal(pinch.defaultPrevented, true);
    assert.equal(pinch.propagationStopped, true);

    const zoomControlPinch = wheelEvent(controlTarget(".graph-zoom-controls"), { deltaY: -40, metaKey: true });
    eventRoot.emit(zoomControlPinch);
    assert.equal(zoomControlPinch.defaultPrevented, true);
    assert.equal(zoomControlPinch.propagationStopped, true);

    const scroll = wheelEvent(controlTarget(".graph-search"), { deltaY: 40 });
    eventRoot.emit(scroll);
    assert.equal(scroll.defaultPrevented, false);
    assert.equal(scroll.propagationStopped, false);
    assert.equal(zoomCalls, 0);
  });

  it("keeps graph ownership when zoom is already clamped at a camera boundary", () => {
    const eventRoot = fakeWheelRoot();
    const ratios: number[] = [];
    bindController({
      eventRoot,
      currentRatio: () => SIGMA_CAMERA_MAX_RATIO,
      onZoomAtPoint: (_point, ratio) => ratios.push(ratio)
    });
    const wheel = wheelEvent(overlayTarget(), { deltaY: 1000, ctrlKey: true });

    eventRoot.emit(wheel);

    assert.equal(wheel.defaultPrevented, true);
    assert.equal(wheel.propagationStopped, true);
    assert.deepEqual(ratios, [SIGMA_CAMERA_MAX_RATIO]);
  });

  it("makes late wheel events no-op after the renderer is destroyed", () => {
    const eventRoot = fakeWheelRoot();
    let zoomCalls = 0;
    let destroyed = false;
    bindController({
      eventRoot,
      isDestroyed: () => destroyed,
      onZoomAtPoint: () => { zoomCalls += 1; }
    });
    destroyed = true;
    const wheel = wheelEvent(overlayTarget(), { deltaY: 120 });

    eventRoot.emit(wheel);

    assert.equal(wheel.defaultPrevented, false);
    assert.equal(wheel.propagationStopped, false);
    assert.equal(zoomCalls, 0);
  });

  it("uses the viewport center for missing coordinates and reports thrown zoom errors", () => {
    const eventRoot = fakeWheelRoot();
    const errors: unknown[] = [];
    const points: Array<{ x: number; y: number }> = [];
    bindController({
      eventRoot,
      viewportRoot: rootWithRect(10, 20, 200, 100),
      onZoomAtPoint: (point) => {
        points.push(point);
        throw new Error("zoom failed");
      },
      onFatalError: (error) => errors.push(error)
    });

    eventRoot.emit(wheelEvent(overlayTarget(), { clientX: Number.NaN, clientY: Number.NaN, deltaY: 120 }));

    assert.deepEqual(sigmaViewportCenter(rootWithRect(10, 20, 200, 100)), { x: 100, y: 50 });
    assert.deepEqual(points, [{ x: 100, y: 50 }]);
    assert.equal((errors[0] as Error).message, "zoom failed");
  });

  it("parses native wheel coordinates relative to the Sigma viewport", () => {
    assert.deepEqual(
      sigmaWheelInputFromPayload(
        wheelEvent(overlayTarget(), { clientX: 35, clientY: 46, deltaY: 12, deltaMode: 1 }),
        rootWithRect(10, 20, 200, 100)
      ),
      { point: { x: 25, y: 26 }, delta: { deltaY: 12, deltaMode: 1 } }
    );
  });
});

function bindController(options: {
  eventRoot?: ReturnType<typeof fakeWheelRoot>;
  viewportRoot?: HTMLElement;
  isDestroyed?: () => boolean;
  currentRatio?: () => number;
  onZoomAtPoint?: (point: { x: number; y: number }, ratio: number) => void;
  onFatalError?: (error: unknown) => void;
} = {}) {
  const eventRoot = options.eventRoot ?? fakeWheelRoot();
  return bindSigmaWheelZoomController({
    root: eventRoot as unknown as HTMLElement,
    viewportRoot: options.viewportRoot ?? rootWithRect(0, 0, 200, 100),
    isDestroyed: options.isDestroyed ?? (() => false),
    currentRatio: options.currentRatio ?? (() => 1),
    onZoomAtPoint: options.onZoomAtPoint ?? (() => undefined),
    onFatalError: options.onFatalError
  });
}

function fakeWheelRoot() {
  const state = {
    onCalls: [] as Array<{ event: "wheel"; listener: EventListener; options: AddEventListenerOptions | boolean | undefined }>,
    offCalls: [] as Array<{ event: "wheel"; listener: EventListener; options: EventListenerOptions | boolean | undefined }>,
    addEventListener(event: "wheel", listener: EventListener, options?: AddEventListenerOptions | boolean) {
      state.onCalls.push({ event, listener, options });
    },
    removeEventListener(event: "wheel", listener: EventListener, options?: EventListenerOptions | boolean) {
      state.offCalls.push({ event, listener, options });
    },
    emit(event: WheelEvent) {
      state.onCalls[0]?.listener(event);
    }
  };
  return state;
}

function wheelEvent(
  target: ReturnType<typeof overlayTarget>,
  init: Partial<WheelEvent> = {}
): WheelEvent & { propagationStopped: boolean } {
  return {
    clientX: 100,
    clientY: 50,
    ctrlKey: false,
    metaKey: false,
    deltaY: 0,
    deltaMode: 0,
    defaultPrevented: false,
    propagationStopped: false,
    target,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...init
  } as unknown as WheelEvent & { propagationStopped: boolean };
}

function overlayTarget() {
  return {
    closest: () => null
  };
}

function controlTarget(selector: string) {
  const target = {
    closest: (candidate: string) => candidate === selector ? target : null
  };
  return target;
}

function rootWithRect(left: number, top: number, width: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({ left, top, width, height })
  } as HTMLElement;
}
