"use client";
import { useIsDesktop, useVisualViewportHeight } from "@/components/mobile/viewport";
import { MobileNav } from "@/components/mobile/drawer";

import { useDefaultLayout } from "react-resizable-panels";

import { usePanelLayoutStorage, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export function ShellPanels({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "thunk-sidebar-layout", panelIds: ['sidebar', 'content'], storage: usePanelLayoutStorage() });
  const desktop = useIsDesktop();
  useVisualViewportHeight(!desktop);
  // On a phone the workspace header opens the sidebar as a sheet, so the page gets the whole screen.
  if (!desktop) return <MobileNav.Provider value={sidebar}><div className="bg-background flex h-[var(--vvh,100dvh)] flex-col pt-safe"><div className="min-h-0 flex-1">{children}</div></div></MobileNav.Provider>;
  return (
    <ResizablePanelGroup defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} orientation="horizontal" className="moonlit sky-surface bg-background h-dvh">
      <ResizablePanel id="sidebar" defaultSize="17" minSize="12" maxSize="30">
        {sidebar}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="content" defaultSize="83" minSize="50">
        <div className="h-full overflow-y-auto">{children}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
