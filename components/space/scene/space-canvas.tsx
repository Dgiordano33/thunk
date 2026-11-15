"use client";

import { useEffect, useRef } from "react";
import { SpaceRenderer } from "./renderer";
import type { SceneStore } from "./scene-store";

/**
 * The WebGL underlay for a solar-system map: a viewport-sized canvas behind the HTML stage, applying the pan and zoom itself.
 * Once it has drawn a frame, `.space` gets `gl-ready` and the SVG fallback art fades out. Without WebGL2, or after the
 * context is lost, the class comes off and the SVG stays.
 */
export function SpaceCanvas({ scene }: { scene: SceneStore }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const root = canvas.closest(".space");
    let renderer: SpaceRenderer | null = null;
    try {
      renderer = new SpaceRenderer(canvas, scene, {
        onReady: () => root?.classList.add("gl-ready"),
        onLost: () => root?.classList.remove("gl-ready"),
        // Share the HTML entrance's clock, so canvas and labels animate together even if WebGL starts late.
        entranceStart: () => {
          const anim = root?.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName === "space-clock");
          const t = anim?.startTime;
          return typeof t === "number" ? t : null;
        },
      });
    } catch {
      return; // No WebGL2: the SVG fallback is already on screen.
    }
    return () => {
      renderer?.dispose();
      root?.classList.remove("gl-ready");
    };
  }, [scene]);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />;
}
