"use client";

import { useDefaultLayout } from "react-resizable-panels";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export function ShellPanels({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "thunk-sidebar-layout", panelIds: ['sidebar', 'content'] });
  return (
    <ResizablePanelGroup defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} orientation="horizontal" className="moonlit bg-background h-dvh">
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
