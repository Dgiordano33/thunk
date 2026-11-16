"use client";

// Shared state between the HTML map and its WebGL underlay. Plain refs and listeners, not React state:
// the view changes every pointer frame and hover changes on every mouse move, and neither should re-render the map.
import { createContext, useContext, useState } from "react";
import { bodyColors, bodySpec, type BodyColors, type BodyKind, type BodySpec } from "@/lib/world/bodies";
import type { PlanetPalette } from "@/lib/world/system";

export type View = { x: number; y: number; z: number };

export type SceneBody = {
  id: string;
  /** Centre in map pixels. */
  x: number;
  y: number;
  /** Radius in map pixels. */
  r: number;
  spec: BodySpec;
  colors: BodyColors;
  dormant: boolean;
  /** Entrance order: lower appears first. */
  order: number;
  /** Bobs gently in place (home map). Its HTML twin, registered with `float()`, moves with it. */
  float?: boolean;
};

export type SceneOrbit = { cx: number; cy: number; r: number; tilt: number; bodies: string[] };

export type SceneData = {
  bodies: SceneBody[];
  orbits: SceneOrbit[];
  /** The star, in map pixels. Without one, light falls from the fixed `keyLight` angle. */
  star: { x: number; y: number } | null;
  /** Screen-space angle (radians) light comes from when there is no star. */
  keyLight?: number;
};

export function makeBody(o: { id: string; x: number; y: number; r: number; kind: BodyKind; palette: PlanetPalette; dormant?: boolean; order?: number; float?: boolean }): SceneBody {
  const spec = bodySpec(o.id, o.kind);
  return { id: o.id, x: o.x, y: o.y, r: o.r, spec, colors: bodyColors(o.palette, spec, !!o.dormant), dormant: !!o.dormant, order: o.order ?? 0, float: o.float };
}

type Listener = () => void;

export class SceneStore {
  view: View = { x: 0, y: 0, z: 1 };
  hover: string | null = null;
  data: SceneData = { bodies: [], orbits: [], star: null };
  /** The body being dragged: it stops bobbing and stays bright. */
  dragging: string | null = null;
  /** HTML elements that bob with their body; the renderer sets their `translate` each frame. */
  floaters = new Map<string, HTMLElement>();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
  setView = (v: View) => {
    this.view = v;
    this.emit();
  };
  setHover = (id: string | null) => {
    if (this.hover === id) return;
    this.hover = id;
    this.emit();
  };
  /** Ref callback for a body's HTML twin. */
  float = (id: string) => (el: HTMLElement | null) => {
    if (el) this.floaters.set(id, el);
    else this.floaters.delete(id);
  };
  setDragging = (id: string | null) => {
    this.dragging = id;
    this.emit();
  };
  setData(d: SceneData) {
    this.data = d;
    this.emit();
  }
}

export const SceneContext = createContext<SceneStore | null>(null);

/** Hover/focus props for an HTML body, so its canvas twin can brighten. Inert outside a scene. */
export function useBodyHover(id: string) {
  const scene = useContext(SceneContext);
  if (!scene) return {};
  const on = () => scene.setHover(id);
  const off = () => scene.hover === id && scene.setHover(null);
  return { onPointerEnter: on, onPointerLeave: off, onFocus: on, onBlur: off };
}

/** One store per map, kept for the component's life. */
export function useSceneStore() {
  const [store] = useState(() => new SceneStore());
  return store;
}
