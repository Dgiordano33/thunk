"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { storeOnboarding, type HintKey } from "@/lib/onboarding";
const Context = createContext<{
  seen: (key: HintKey) => boolean;
  markSeen: (key: HintKey) => void;
  replay: (key: HintKey) => void;
  resetAll: () => void;
} | null>(null);
export function OnboardingProvider({ initial, children }: { initial: HintKey[]; children: ReactNode }) {
  const [keys, setKeys] = useState(initial);
  const save = (next: HintKey[]) => { storeOnboarding(next); setKeys(next); };
  return <Context.Provider value={{
    seen: (key) => keys.includes(key),
    markSeen: (key) => { if (!keys.includes(key)) save([...keys, key]); },
    replay: (key) => save(keys.filter((k) => k !== key)),
    resetAll: () => save([]),
  }}>{children}</Context.Provider>;
}
export function useOnboarding() {
  const state = useContext(Context);
  if (!state) throw new Error("OnboardingProvider is missing");
  return state;
}
