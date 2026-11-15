"use client";

import { useEffect } from "react";

/**
 * Design-mock only: pins a palette class (and the light/dark class) on <html> so portalled cards inherit it.
 * The app's theme provider runs its effect after this one and on system changes, so the dark class is re-pinned whenever it moves.
 */
export function MockTheme({ variant, dark }: { variant: string; dark: boolean }) {
  useEffect(() => {
    const root = document.documentElement;
    const cls = `mock-${variant}`;
    const hadDark = root.classList.contains("dark");
    const pin = () => {
      if (!root.classList.contains(cls)) root.classList.add(cls);
      if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark);
    };
    pin();
    const observer = new MutationObserver(pin);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      root.classList.remove(cls);
      root.classList.toggle("dark", hadDark);
    };
  }, [variant, dark]);
  return null;
}
