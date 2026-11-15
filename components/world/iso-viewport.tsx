"use client";

import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { ease, prefersReducedMotion } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { CivPanel } from "./civ-panel";

const MAX_ZOOM = 2;
const MIN_ZOOM = 0.6;
/** Pointer travel (px) before a press becomes a pan instead of a click. */
const DRAG_SLOP = 4;
/** Camera tween for fit, zoom buttons, keyboard zoom and double-click, when `smooth`. */
const TWEEN_MS = 240;

/** Square icon button for the control column. */
export const CONTROL_BUTTON = "hover:bg-muted focus-visible:ring-ring flex size-8 items-center justify-center outline-none focus-visible:ring-2";

const ZOOM_CONTROLS = [
  { label: "Zoom in", icon: PlusIcon, factor: 1.25 },
  { label: "Zoom out", icon: MinusIcon, factor: 0.8 },
  { label: "Fit map", icon: ScanIcon, factor: null },
];

export type View = { x: number; y: number; z: number };

/**
 * Drag-to-pan, wheel-to-zoom viewport over an isometric map, with zoom controls bottom-right.
 * `focus` (map pixels) is centred on mount at zoom `focus.z`; otherwise the whole map is fitted.
 */
export function IsoViewport({
  width,
  height,
  label,
  focus,
  stage,
  controls,
  underlay,
  onView,
  smooth = false,
  controlsClassName,
  children,
}: {
  width: number;
  height: number;
  label: string;
  focus?: { x: number; y: number; z: number };
  stage: React.ReactNode;
  /** Extra buttons for the control column, e.g. a legend popover. */
  controls?: React.ReactNode;
  /** A layer behind the stage that is not panned, e.g. a canvas that applies the view itself via `onView`. */
  underlay?: React.ReactNode;
  /** Called with every new view (stage offset in px and zoom). */
  onView?: (view: View) => void;
  /** Tween fit, zoom buttons, keyboard zoom and double-click. Wheel and drag stay direct. */
  smooth?: boolean;
  controlsClassName?: string;
  /** Overlays above the map (not panned). */
  children?: React.ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Pan/zoom lives outside React state: it changes every pointer frame and only touches one transform.
  const view = useRef<View>({ x: 0, y: 0, z: 1 });
  const minZoom = useRef(MIN_ZOOM);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const tween = useRef<{ raf: number; to: View } | null>(null);
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  });

  const clamp = useCallback((next: View): View | null => {
    const el = viewport.current;
    if (!el) return null;
    const z = Math.min(MAX_ZOOM, Math.max(minZoom.current, next.z));
    // Keep some of the continent under the middle of the screen.
    const x = Math.min(el.clientWidth / 2, Math.max(el.clientWidth / 2 - width * z, next.x));
    const y = Math.min(el.clientHeight / 2, Math.max(el.clientHeight / 2 - height * z, next.y));
    return { x, y, z };
  }, [width, height]);

  const apply = useCallback((next: View) => {
    const v = clamp(next);
    if (!v || !stageRef.current) return;
    view.current = v;
    stageRef.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.z})`;
    onViewRef.current?.(v);
  }, [clamp]);

  const cancelTween = useCallback(() => {
    if (tween.current) cancelAnimationFrame(tween.current.raf);
    tween.current = null;
  }, []);

  /** Moves the camera: tweened when `smooth` (and motion is allowed), otherwise at once. */
  const go = useCallback((next: View) => {
    cancelTween();
    const to = clamp(next);
    if (!to) return;
    if (!smooth || prefersReducedMotion()) return apply(to);
    const from = view.current;
    const start = performance.now();
    const frame = (now: number) => {
      const t = ease((now - start) / TWEEN_MS);
      // Interpolate zoom geometrically so the zoom point stays put.
      const z = from.z * Math.pow(to.z / from.z, t);
      const k = from.z === to.z ? t : (z - from.z) / (to.z - from.z);
      apply({ z, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
      if (t < 1 && tween.current) tween.current.raf = requestAnimationFrame(frame);
      else tween.current = null;
    };
    tween.current = { raf: requestAnimationFrame(frame), to };
  }, [apply, cancelTween, clamp, smooth]);

  const fit = useCallback((animate = false) => {
    const el = viewport.current;
    if (!el) return;
    const z = Math.min(1.25, (Math.min(el.clientWidth / width, el.clientHeight / height) || 1) * 0.92);
    minZoom.current = Math.min(MIN_ZOOM, z);
    const next = { z, x: (el.clientWidth - width * z) / 2, y: (el.clientHeight - height * z) / 2 };
    if (animate) go(next);
    else {
      cancelTween();
      apply(next);
    }
  }, [apply, cancelTween, go, width, height]);

  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number, animate = false) => {
      const el = viewport.current;
      if (!el) return;
      // Repeated clicks during a tween build on where it is heading, not where it is.
      const base = animate && tween.current ? tween.current.to : view.current;
      if (!animate) cancelTween();
      const { x, y, z } = base;
      const nz = Math.min(MAX_ZOOM, Math.max(minZoom.current, z * factor));
      const cx = px ?? el.clientWidth / 2;
      const cy = py ?? el.clientHeight / 2;
      const next = { z: nz, x: cx - ((cx - x) * nz) / z, y: cy - ((cy - y) * nz) / z };
      if (animate) go(next);
      else apply(next);
    },
    [apply, cancelTween, go],
  );

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    fit();
    if (focus) apply({ z: focus.z, x: el.clientWidth / 2 - focus.x * focus.z, y: el.clientHeight / 2 - focus.y * focus.z });
    let fitted = { w: el.clientWidth, h: el.clientHeight };
    const observer = new ResizeObserver(() => {
      // Re-centre on real resizes, not the no-op callback every observer fires on attach.
      if (el.clientWidth === fitted.w && el.clientHeight === fitted.h) return;
      fitted = { w: el.clientWidth, h: el.clientHeight };
      fit();
    });
    observer.observe(el);
    // React's onWheel is passive, so it can't stop the page from scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
      cancelTween();
    };
    // Focus only on mount: later prop changes (new farms, panels opening) must not yank the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, zoomAt]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    cancelTween();
    drag.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: view.current.x, oy: view.current.y, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.sx;
    const dy = event.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!d.moved) {
      d.moved = true;
      viewport.current?.setPointerCapture(event.pointerId);
    }
    apply({ ...view.current, x: d.ox + dx, y: d.oy + dy });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    suppressClick.current = d.moved;
    drag.current = null;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = 60;
    const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (event.target !== event.currentTarget) return;
    if (pan[event.key]) {
      event.preventDefault();
      apply({ ...view.current, x: view.current.x + pan[event.key][0], y: view.current.y + pan[event.key][1] });
    } else if (event.key === "+" || event.key === "=") zoomAt(1.2, undefined, undefined, true);
    else if (event.key === "-") zoomAt(1 / 1.2, undefined, undefined, true);
    else if (event.key === "0") fit(true);
  };

  return (
    <div className="absolute inset-0">
      <div
        ref={viewport}
        role="application"
        aria-label={`${label}. Drag or use arrow keys to pan, scroll or plus and minus to zoom.`}
        tabIndex={0}
        className="absolute inset-0 cursor-grab touch-none overflow-hidden outline-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) return;
          const rect = event.currentTarget.getBoundingClientRect();
          zoomAt(1.6, event.clientX - rect.left, event.clientY - rect.top, true);
        }}
        onClickCapture={(event) => {
          // A pan that ends over a building must not open it.
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        {underlay}
        <div ref={stageRef} className="absolute top-0 left-0 origin-top-left will-change-transform" style={{ width: width, height: height }}>
          {stage}
        </div>
      </div>

      {children}

      {/* In dev, clear the Retune button in the bottom-right corner. */}
      <div className={cn("pointer-events-none absolute right-4 z-20 flex flex-col items-end gap-2", process.env.NODE_ENV === "development" ? "bottom-18" : "bottom-4")}>
        <CivPanel className="pointer-events-auto" bodyClassName={cn("flex flex-col", controlsClassName)}>
          {ZOOM_CONTROLS.map(({ label, icon: Icon, factor }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => (factor ? zoomAt(factor, undefined, undefined, true) : fit(true))}
              className={CONTROL_BUTTON}
            >
              <Icon className="size-4" />
            </button>
          ))}
          {controls}
        </CivPanel>
      </div>
    </div>
  );
}
