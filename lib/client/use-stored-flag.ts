"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
};

/**
 * A boolean remembered in localStorage across visits. The server render uses `fallback`;
 * the stored value takes over after hydration.
 */
export function useStoredFlag(key: string | undefined, fallback: boolean): [boolean, (next: boolean) => void] {
  const read = () => {
    if (!key) return fallback;
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  };
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback(
    (next: boolean) => {
      if (!key) return;
      try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* Storage is optional. */ }
      listeners.forEach((fn) => fn());
    },
    [key],
  );
  return [value, set];
}
