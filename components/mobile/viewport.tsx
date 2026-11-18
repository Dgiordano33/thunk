"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

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
