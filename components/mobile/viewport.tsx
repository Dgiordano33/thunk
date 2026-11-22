"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

const InitialDesktop = createContext(true);
const query = "(min-width: 768px)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
export function ViewportProvider({ initialDesktop, children }: { initialDesktop: boolean; children: React.ReactNode }) {
  return <InitialDesktop.Provider value={initialDesktop}>{children}</InitialDesktop.Provider>;
}
export function useIsDesktop() {
  const initial = useContext(InitialDesktop);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => initial);
}
export function ResponsiveView({ mobile, children }: { mobile: React.ReactNode; children: React.ReactNode }) {
  return useIsDesktop() ? children : mobile;
}

/**
 * Keeps `--vvh` on the root at the height left above the on-screen keyboard. iOS Safari overlays the keyboard
 * instead of resizing the page, so a full-height layout would otherwise leave the composer underneath it.
 */
export function useVisualViewportHeight(enabled: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--vvh", `${viewport.height}px`);
      // Safari scrolls the page to reveal a focused field; the layout already fits, so undo it.
      if (viewport.offsetTop) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--vvh");
    };
  }, [enabled]);
}
