"use client";
import { useIsDesktop } from "@/components/mobile/viewport";
import { MobileDrawer } from "@/components/mobile/drawer";

import { useDefaultLayout } from "react-resizable-panels";

import { usePanelLayoutStorage, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export function ShellPanels({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "thunk-sidebar-layout", panelIds: ['sidebar', 'content'], storage: usePanelLayoutStorage() });
  const desktop = useIsDesktop();
  if (!desktop) return <div className="flex h-dvh flex-col bg-background"><div className="border-b pt-safe"><MobileDrawer title="Navigation" side="left">{sidebar}</MobileDrawer></div><div className="min-h-0 flex-1">{children}</div></div>;
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
