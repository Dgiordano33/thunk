"use client";
import { useIsDesktop, useVisualViewportHeight } from "@/components/mobile/viewport";
import { MobileNav } from "@/components/mobile/drawer";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";

import { usePanelLayoutStorage, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

/** Width of the collapsed sidebar: an icon rail. */
const RAIL_PX = 52;
/** An expanded sidebar is never under its 12% minimum, so a smaller stored share means the rail (read on the server too). */
const RAIL_PERCENT = 12;

/** The last expanded width, so expanding after a reload returns to it rather than the minimum. */
const WIDTH_KEY = "thunk.sidebar.width";

const SidebarState = createContext<{ collapsed: boolean; toggle: () => void }>({ collapsed: false, toggle: () => {} });
/** Whether the desktop sidebar is collapsed to its rail, and a toggle (also bound to ⌘\). Always expanded on a phone. */
export const useSidebarState = () => useContext(SidebarState);

export function ShellPanels({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "thunk-sidebar-layout", panelIds: ['sidebar', 'content'], storage: usePanelLayoutStorage() });
  const desktop = useIsDesktop();
  useVisualViewportHeight(!desktop);
  const panelRef = usePanelRef();
  const [collapsed, setCollapsed] = useState(() => (defaultLayout?.sidebar ?? 17) < RAIL_PERCENT);
  const toggle = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!panel.isCollapsed()) { panel.collapse(); return; }
    let width = "17";
    try { width = localStorage.getItem(WIDTH_KEY) ?? width; } catch { /* Storage is optional. */ }
    panel.resize(width);
  }, [panelRef]);
  useEffect(() => {
    if (!desktop) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\" && !event.defaultPrevented) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, toggle]);
  const state = useMemo(() => ({ collapsed: desktop && collapsed, toggle }), [desktop, collapsed, toggle]);

  // On a phone the workspace header opens the sidebar as a sheet, so the page gets the whole screen.
  if (!desktop) return <MobileNav.Provider value={sidebar}><div className="bg-background flex h-[var(--vvh,100dvh)] flex-col pt-safe"><div className="min-h-0 flex-1">{children}</div></div></MobileNav.Provider>;
  return (
    <SidebarState.Provider value={state}>
      <ResizablePanelGroup defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} orientation="horizontal" className="moonlit sky-surface bg-background h-dvh">
        <ResizablePanel
          id="sidebar"
          panelRef={panelRef}
          defaultSize="17"
          minSize="12"
          maxSize="30"
          collapsible
          collapsedSize={RAIL_PX}
          onResize={(size) => {
            const rail = size.inPixels <= RAIL_PX + 1;
            setCollapsed(rail);
            if (!rail) try { localStorage.setItem(WIDTH_KEY, String(Math.round(size.asPercentage * 10) / 10)); } catch { /* Storage is optional. */ }
          }}
        >
          {sidebar}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="content" defaultSize="83" minSize="50">
          <div className="h-full overflow-y-auto">{children}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </SidebarState.Provider>
  );
}
