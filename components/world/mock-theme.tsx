"use client";

import { useEffect } from "react";

/** Design-mock only: pins a palette class (and the light/dark class) on <html> so portalled cards inherit it. */
export function MockTheme({ variant, dark }: { variant: string; dark: boolean }) {
  useEffect(() => {
    const root = document.documentElement;
    const cls = `mock-${variant}`;
    const hadDark = root.classList.contains("dark");
    root.classList.add(cls);
    root.classList.toggle("dark", dark);
    return () => {
      root.classList.remove(cls);
      root.classList.toggle("dark", hadDark);
    };
  }, [variant, dark]);
  return null;
}
