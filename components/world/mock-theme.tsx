"use client";

import { useEffect } from "react";
import { lookClass, type Look } from "@/lib/look";

/**
 * Design-mock only: pins a palette class, the look and the light/dark class on <html> so portalled cards inherit them.
 * The app's theme provider runs its effect after this one and on system changes, so the classes are re-pinned whenever they move.
 */
export function MockTheme({ variant, dark, look }: { variant: string; dark: boolean; look: Look }) {
  useEffect(() => {
    const root = document.documentElement;
    const cls = `mock-${variant}`;
    const want = lookClass(look);
    const other = lookClass(look === "space" ? "world" : "space");
    const hadDark = root.classList.contains("dark");
    const hadLook = root.classList.contains(lookClass("world")) ? lookClass("world") : lookClass("space");
    const pin = () => {
      if (!root.classList.contains(cls)) root.classList.add(cls);
      if (!root.classList.contains(want)) root.classList.add(want);
      if (root.classList.contains(other)) root.classList.remove(other);
      if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark);
    };
    pin();
    const observer = new MutationObserver(pin);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      root.classList.remove(cls, want);
      root.classList.add(hadLook);
      root.classList.toggle("dark", hadDark);
    };
  }, [variant, dark, look]);
  return null;
}
