"use client";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export function ShellPanels({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-dvh">
      <ResizablePanel defaultSize="17" minSize="12" maxSize="30">
        {sidebar}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="83" minSize="50">
        <div className="h-full overflow-y-auto">{children}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
