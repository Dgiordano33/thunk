"use client";
import { useIsDesktop } from "./viewport";
import { MobileDrawer } from "./drawer";
export function ComposerOptions({ children }: { children: React.ReactNode }) {
  return useIsDesktop() ? children : <MobileDrawer title="Model and permissions"><div className="flex flex-col gap-4 p-4">{children}</div></MobileDrawer>;
}
