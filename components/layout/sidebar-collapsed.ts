"use client";
import { useMemo, useSyncExternalStore } from "react";

const COLLAPSED_KEY = "thunk.sidebar.collapsed";
/** Collapsed sidebar groups by id, remembered across reloads. Read through useSyncExternalStore so hydration agrees with the server. */
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(COLLAPSED_KEY) ?? "{}"; } catch { return "{}"; } };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
};

export function useCollapsed() {
  const raw = useSyncExternalStore(subscribe, read, () => "{}");
  const collapsed = useMemo<Record<string, boolean>>(() => { try { return JSON.parse(raw); } catch { return {}; } }, [raw]);
  const toggle = (id: string, collapse: boolean) => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ ...collapsed, [id]: collapse })); } catch { /* Storage is optional. */ }
    listeners.forEach((listener) => listener());
  };
  return { collapsed, toggle };
}
