"use client";

import { InfoIcon, MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useAmbient } from "@/lib/store/ambient-store";
import { LEVEL_NAMES, LEVEL_THRESHOLDS, cityActivity, type WorldCity } from "@/lib/world/cities";
import { MAP_H, MAP_W } from "@/lib/world/terrain";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CivPanel } from "./civ-panel";
import { City } from "./city";
import { TerrainLayer } from "./terrain-layer";

const MAX_ZOOM = 2;
const MIN_ZOOM = 0.6;
/** Pointer travel (px) before a press becomes a pan instead of a click. */
const DRAG_SLOP = 4;

const ZOOM_CONTROLS = [
  { label: "Zoom in", icon: PlusIcon, factor: 1.25 },
  { label: "Zoom out", icon: MinusIcon, factor: 0.8 },
  { label: "Fit map", icon: ScanIcon, factor: null },
];

type View = { x: number; y: number; z: number };

export function WorldMap({ cities, children }: { cities: WorldCity[]; children?: React.ReactNode }) {
  const sessions = useAmbient((s) => s.sessions);
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // Pan/zoom lives outside React state: it changes every pointer frame and only touches one transform.
  const view = useRef<View>({ x: 0, y: 0, z: 1 });
  const minZoom = useRef(MIN_ZOOM);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const apply = useCallback((next: View) => {
    const el = viewport.current;
    if (!el || !stage.current) return;
    const z = Math.min(MAX_ZOOM, Math.max(minZoom.current, next.z));
    // Keep some of the continent under the middle of the screen.
    const x = Math.min(el.clientWidth / 2, Math.max(el.clientWidth / 2 - MAP_W * z, next.x));
    const y = Math.min(el.clientHeight / 2, Math.max(el.clientHeight / 2 - MAP_H * z, next.y));
    view.current = { x, y, z };
    stage.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
  }, []);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const z = Math.min(1.25, (Math.min(el.clientWidth / MAP_W, el.clientHeight / MAP_H) || 1) * 0.92);
    minZoom.current = Math.min(MIN_ZOOM, z);
    apply({ z, x: (el.clientWidth - MAP_W * z) / 2, y: (el.clientHeight - MAP_H * z) / 2 });
  }, [apply]);

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
        aria-label="World map. Drag or use arrow keys to pan, scroll or plus and minus to zoom."
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
          // A pan that ends over a city must not open it.
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <div ref={stage} className="absolute top-0 left-0 origin-top-left will-change-transform" style={{ width: MAP_W, height: MAP_H }}>
          <TerrainLayer cities={cities} />
          {cities.map((city) => (
            <City key={city.project.id} city={city} activity={cityActivity(sessions, city.project.id)} />
          ))}
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
              className="hover:bg-muted focus-visible:ring-ring flex size-8 items-center justify-center outline-none focus-visible:ring-2"
            >
              <Icon className="size-4" />
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Map legend"
                title="Map legend"
                className="hover:bg-muted focus-visible:ring-ring flex size-8 items-center justify-center outline-none focus-visible:ring-2"
              >
                <InfoIcon className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="left" align="end" className="w-auto rounded-none bg-transparent p-0 shadow-none ring-0" aria-label="Map legend">
              <Legend />
            </PopoverContent>
          </Popover>
        </CivPanel>
      </div>
    </div>
  );
}

function Legend() {
  const ranges = LEVEL_NAMES.map((name, i) => {
    const lo = i === 0 ? 0 : LEVEL_THRESHOLDS[i - 1];
    const hi = LEVEL_THRESHOLDS[i];
    return { name, level: i + 1, range: hi === undefined ? `${lo}+` : lo === hi - 1 ? `${lo}` : `${lo}–${hi - 1}` };
  });
  return (
    <CivPanel className="pointer-events-auto w-52" bodyClassName="px-3 py-2">
      <p className="pixel text-sm">Legend</p>
      <p className="text-muted-foreground mb-1.5 text-[11px]">Population = workspaces × 2 + sessions</p>
      <ul className="grid gap-0.5 text-xs">
        {ranges.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="pixel bg-foreground/80 text-background flex size-4 items-center justify-center text-[10px]">{r.level}</span>
            <span>{r.name}</span>
            <span className="text-muted-foreground ml-auto tabular-nums">{r.range}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-2 grid gap-0.5 border-t pt-1.5 text-xs">
        <li className="flex items-center gap-2"><span className="size-2 bg-[oklch(0.92_0_0)] ring-1 ring-black/30" /> Smoke: session running</li>
        <li className="flex items-center gap-2"><span className="pixel flex size-3 items-center justify-center bg-[oklch(0.86_0.17_90)] text-[9px] text-black">!</span> Needs attention</li>
        <li className="flex items-center gap-2"><span className="pixel text-muted-foreground text-[10px]">zzz</span> Dormant 30+ days</li>
      </ul>
    </CivPanel>
  );
}
