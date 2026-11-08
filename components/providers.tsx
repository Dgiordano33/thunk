"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { useUi } from "@/lib/store/ui-store";
import { applyTheme, readTheme } from "@/lib/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(useUi.getState().theme, media.matches);
    useUi.setState({ theme: readTheme() });
    apply();
    const unsubscribe = useUi.subscribe((state, previous) => {
      if (state.theme !== previous.theme) apply();
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key === "thunk.theme" || event.key === null) useUi.setState({ theme: readTheme() });
    };
    media.addEventListener("change", apply);
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return <TooltipProvider delayDuration={300}>{children}</TooltipProvider>;
}
