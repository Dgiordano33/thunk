"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Maximize2Icon, Minimize2Icon, RotateCcwIcon } from "lucide-react";
import { useLook } from "@/components/look-context";
import { useIsDesktop } from "@/components/mobile/viewport";
import { cn } from "@/lib/utils";

type Rect = { x: number; y: number; width: number; height: number };
const Controls = createContext<React.ReactNode>(null);
export function WindowControls() { return useContext(Controls); }
/** Marks a window's own header as its drag handle (double-click maximizes; arrow keys move, Shift+arrows resize). */
export function useWindowHandle() {
  const isDesktop = useIsDesktop();
  const vanilla = useLook().look === "vanilla";
  const desktop = isDesktop && !vanilla;
  return { "data-window-drag": "", tabIndex: desktop ? 0 : undefined, title: desktop ? "Drag to move · double-click to maximize" : undefined } as const;
}
const handles = {
  n: "inset-x-2 -top-1 h-2 cursor-ns-resize", s: "inset-x-2 -bottom-1 h-2 cursor-ns-resize",
  e: "inset-y-2 -right-1 w-2 cursor-ew-resize", w: "inset-y-2 -left-1 w-2 cursor-ew-resize",
  ne: "-right-1 -top-1 size-3 cursor-nesw-resize", nw: "-left-1 -top-1 size-3 cursor-nwse-resize",
  se: "-right-1 -bottom-1 size-4 cursor-nwse-resize", sw: "-left-1 -bottom-1 size-3 cursor-nesw-resize",
};
const interactive = "button,a,input,textarea,select,[role=button],[contenteditable=true]";

/** Keeps route content mounted while its desktop frame moves; mobile retains its original layout. */
export function FloatingWindow({ children, className, style, as: Tag = "main", dragAnywhere }: {
  children: React.ReactNode; className?: string; style?: CSSProperties; as?: "main" | "aside";
  /** Small cards with no header: drag from any non-interactive spot. */
  dragAnywhere?: boolean;
}) {
  const isDesktop = useIsDesktop();
  const vanilla = useLook().look === "vanilla";
  const desktop = isDesktop && !vanilla;
  const ref = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; rect: Rect; edge: string; capture: HTMLElement } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [active, setActive] = useState(false);
  const [moving, setMoving] = useState(false);
  const bounds = () => {
    const parent = ref.current?.offsetParent as HTMLElement | null;
    return { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight };
  };
  const fit = (r: Rect): Rect => {
    const b = bounds();
    const width = Math.min(r.width, b.width - 16);
    const height = Math.min(r.height, b.height - 96);
    return { width, height, x: Math.max(8, Math.min(r.x, b.width - width - 8)), y: Math.max(80, Math.min(r.y, b.height - height - 16)) };
  };
  const measure = (): Rect => {
    const el = ref.current!;
    return { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
  };
  useEffect(() => {
    const onResize = () => setRect(current => current ? fit(current) : null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // Bounds are measured from the current DOM, independent of render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleMaximize = () => { if (!maximized && !rect) setRect(measure()); setMaximized(!maximized); };
  const begin = (event: PointerEvent<HTMLElement>, edge = "") => {
    if (!desktop || maximized || gesture.current || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const capture = edge ? event.currentTarget : (event.target as HTMLElement).closest<HTMLElement>("[data-window-drag]")!;
    if (!edge) capture.focus({ preventScroll: true });
    capture.setPointerCapture(event.pointerId);
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect: measure(), edge, capture };
    setMoving(true);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (!g.edge) { setRect(fit({ ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy })); return; }
    const b = bounds(), r = g.rect;
    let left = r.x, top = r.y, right = r.x + r.width, bottom = r.y + r.height;
    const minWidth = Math.min(360, r.width), minHeight = Math.min(240, r.height);
    if (g.edge.includes("w")) left = Math.max(8, Math.min(right - minWidth, left + dx));
    if (g.edge.includes("e")) right = Math.min(b.width - 8, Math.max(left + minWidth, right + dx));
    if (g.edge.includes("n")) top = Math.max(80, Math.min(bottom - minHeight, top + dy));
    if (g.edge.includes("s")) bottom = Math.min(b.height - 16, Math.max(top + minHeight, bottom + dy));
    setRect({ x: left, y: top, width: right - left, height: bottom - top });
  };
  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.capture.hasPointerCapture(g.id)) g.capture.releasePointerCapture(g.id);
    setMoving(false);
  };
  const controls = <div className="hidden shrink-0 items-center gap-1 md:flex">
    <button type="button" aria-label="Reset window layout" title="Reset window layout" className="flex size-8 items-center justify-center hover:bg-muted focus-visible:outline-2" onClick={() => { setRect(null); setMaximized(false); }}><RotateCcwIcon className="size-3.5" /></button>
    <button type="button" aria-label={maximized ? "Restore window" : "Maximize window"} title={maximized ? "Restore window" : "Maximize window"} className="flex size-8 items-center justify-center hover:bg-muted focus-visible:outline-2" onClick={toggleMaximize}>{maximized ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}</button>
  </div>;
  const geometry: CSSProperties = !desktop ? {} : maximized
    ? { left: 8, top: 80, right: 8, bottom: 16, width: "auto", height: "auto" }
    : rect ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height, right: "auto", bottom: "auto" } : {};
  if (vanilla && isDesktop) return <Controls.Provider value={null}><Tag className="vanilla-panel flex h-full min-h-0 w-full flex-col">{children}</Tag></Controls.Provider>;
  return <Controls.Provider value={controls}><Tag ref={ref} data-floating-window="" data-window-drag={desktop && dragAnywhere ? "" : undefined} data-maximized={maximized} data-window-sized={desktop && (!!rect || maximized)} className={cn(className, "floating-window", moving && "select-none")} style={{ ...style, ...geometry, ...(active ? { zIndex: 31 } : {}) }}
    onPointerDownCapture={() => setActive(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setActive(false); }}
    onPointerDown={event => { const target = event.target as HTMLElement; if (target.closest("[data-window-drag]") && !target.closest(interactive)) begin(event); }}
    onDoubleClick={event => { const target = event.target as HTMLElement; if (desktop && target.closest("[data-window-drag]") && !target.closest(interactive)) toggleMaximize(); }}
    onKeyDown={event => {
      if (!desktop || maximized || !(event.target as HTMLElement).matches("[data-window-drag]") || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const r = measure(), dx = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0, dy = event.key === "ArrowUp" ? -16 : event.key === "ArrowDown" ? 16 : 0;
      setRect(fit(event.shiftKey ? { ...r, width: Math.max(360, r.width + dx), height: Math.max(240, r.height + dy) } : { ...r, x: r.x + dx, y: r.y + dy }));
    }}
    onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    {children}
    {desktop && !maximized && Object.entries(handles).map(([edge, classes]) => <div key={edge} data-window-resize={edge} aria-hidden="true" className={cn("absolute z-10 touch-none", classes)} onPointerDown={event => begin(event, edge)} />)}
  </Tag></Controls.Provider>;
}
