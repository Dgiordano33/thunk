"use client";

import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { CivPanel } from "./civ-panel";

const MAX_ZOOM = 2;
const MIN_ZOOM = 0.6;
/** Pointer travel (px) before a press becomes a pan instead of a click. */
const DRAG_SLOP = 4;

/** Square icon button for the control column. */
export const CONTROL_BUTTON = "hover:bg-muted focus-visible:ring-ring flex size-8 items-center justify-center outline-none focus-visible:ring-2";

const ZOOM_CONTROLS = [
  { label: "Zoom in", icon: PlusIcon, factor: 1.25 },
  { label: "Zoom out", icon: MinusIcon, factor: 0.8 },
  { label: "Fit map", icon: ScanIcon, factor: null },
];

type View = { x: number; y: number; z: number };

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
  children,
}: {
  width: number;
  height: number;
  label: string;
  focus?: { x: number; y: number; z: number };
  stage: React.ReactNode;
  /** Extra buttons for the control column, e.g. a legend popover. */
  controls?: React.ReactNode;
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

  const apply = useCallback((next: View) => {
    const el = viewport.current;
    if (!el || !stageRef.current) return;
    const z = Math.min(MAX_ZOOM, Math.max(minZoom.current, next.z));
    // Keep some of the continent under the middle of the screen.
    const x = Math.min(el.clientWidth / 2, Math.max(el.clientWidth / 2 - width * z, next.x));
    const y = Math.min(el.clientHeight / 2, Math.max(el.clientHeight / 2 - height * z, next.y));
    view.current = { x, y, z };
    stageRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
  }, [width, height]);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const z = Math.min(1.25, (Math.min(el.clientWidth / width, el.clientHeight / height) || 1) * 0.92);
    minZoom.current = Math.min(MIN_ZOOM, z);
    apply({ z, x: (el.clientWidth - width * z) / 2, y: (el.clientHeight - height * z) / 2 });
  }, [apply, width, height]);

  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number) => {
      const el = viewport.current;
      if (!el) return;
      const { x, y, z } = view.current;
      const nz = Math.min(MAX_ZOOM, Math.max(minZoom.current, z * factor));
      const cx = px ?? el.clientWidth / 2;
      const cy = py ?? el.clientHeight / 2;
      apply({ z: nz, x: cx - ((cx - x) * nz) / z, y: cy - ((cy - y) * nz) / z });
    },
    [apply],
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
    };
    // Focus only on mount: later prop changes (new farms, panels opening) must not yank the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, zoomAt]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
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
    } else if (event.key === "+" || event.key === "=") zoomAt(1.2);
    else if (event.key === "-") zoomAt(1 / 1.2);
    else if (event.key === "0") fit();
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
          zoomAt(1.6, event.clientX - rect.left, event.clientY - rect.top);
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
        <div ref={stageRef} className="absolute top-0 left-0 origin-top-left will-change-transform" style={{ width: width, height: height }}>
          {stage}
        </div>
      </div>

      {children}

      {/* In dev, clear the Retune button in the bottom-right corner. */}
      <div className={cn("pointer-events-none absolute right-4 z-20 flex flex-col items-end gap-2", process.env.NODE_ENV === "development" ? "bottom-18" : "bottom-4")}>
        <CivPanel className="pointer-events-auto" bodyClassName="flex flex-col">
          {ZOOM_CONTROLS.map(({ label, icon: Icon, factor }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => (factor ? zoomAt(factor) : fit())}
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
