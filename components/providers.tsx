"use client";
import { usePathname } from "next/navigation";
import { CaptureBar } from "@/components/capture/capture-bar";
import { OnboardingProvider } from "@/components/onboarding/provider";
import { Intro } from "@/components/onboarding/intro";
import type { HintKey } from "@/lib/onboarding";

import { ViewportProvider } from "@/components/mobile/viewport";
import { ConfirmHost } from "@/components/confirm";
import { LookProvider } from "@/components/look-context";
import type { Look } from "@/lib/look";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { useUi } from "@/lib/store/ui-store";
import { applyTheme, readTheme } from "@/lib/theme";
import { APP_SHORTCUT_KEY, readAppShortcut } from "@/lib/capture/shortcut";

export function Providers({ look, initialDesktop, children, onboarding, hasProjects }: { onboarding: HintKey[]; hasProjects: boolean; look: Look; initialDesktop: boolean; children: React.ReactNode }) {
  const captureOnly = usePathname() === "/capture";
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(useUi.getState().theme, media.matches);
    useUi.setState({ theme: readTheme(), captureShortcut: readAppShortcut() });
    apply();
    const unsubscribe = useUi.subscribe((state, previous) => {
      if (state.theme !== previous.theme) apply();
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key === "thunk.theme" || event.key === null) useUi.setState({ theme: readTheme() });
      if (event.key === APP_SHORTCUT_KEY || event.key === null) useUi.setState({ captureShortcut: readAppShortcut() });
    };
    media.addEventListener("change", apply);
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return (
    <ViewportProvider initialDesktop={initialDesktop}><LookProvider initial={look}>
      <OnboardingProvider initial={onboarding}><TooltipProvider delayDuration={300}>
        {children}
        {!captureOnly && <Intro hasProjects={hasProjects} />}
        <ConfirmHost />
        <CaptureBar />
        <Toaster position="bottom-right" />
      </TooltipProvider></OnboardingProvider>
    </LookProvider></ViewportProvider>
  );
}
