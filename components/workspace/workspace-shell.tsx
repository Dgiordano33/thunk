"use client";
import { useIsDesktop } from "@/components/mobile/viewport";
import { MobileDrawer, MobileNav } from "@/components/mobile/drawer";
import { MenuIcon, PanelBottomIcon } from "lucide-react";
import { useContext } from "react";

import { useDefaultLayout } from "react-resizable-panels";

import { useParams } from "next/navigation";
import { CommentsPanel } from "@/components/comments/comments-panel";
import { usePanelLayoutStorage, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { SessionMeta } from "@/lib/agent/types";
import { useUi } from "@/lib/store/ui-store";
import { WorkspaceConsole } from "./workspace-console";
import { WorkspacePanel } from "./workspace-panel";
import { WorkspaceBaseProvider } from "./route-context";

/** Session tabs and the open page on the left; workspace-wide panel (or the open session's comments) over the workspace console on the right. */
export function WorkspaceShell({
  hasGit,
  workspaceId,
  projectId,
  base,
  sessions,
  tabs,
  children,
}: {
  hasGit: boolean;
  workspaceId: string;
  projectId: string;
  /** The workspace page URL, `/{project}/{workspace}`. */
  base: string;
  sessions: SessionMeta[];
  tabs: React.ReactNode;
  children: React.ReactNode;
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "thunk-chat-layout", panelIds: ['chat', 'tools'], storage: usePanelLayoutStorage() });
  const { session } = useParams<{ session?: string }>();
  const desktop = useIsDesktop();
  const nav = useContext(MobileNav);
  const commentsOpen = useUi((s) => s.commentsOpen);
  const showComments = commentsOpen && !!session;

  // One bar on a phone: navigation, the session switcher (from `tabs`), then the workspace's tools.
  if (!desktop) return (
    <WorkspaceBaseProvider value={base}>
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b px-1">
          <MobileDrawer title="Navigation" side="left" className="px-0" trigger={<MenuIcon className="mx-auto size-5" />}>{nav}</MobileDrawer>
          {tabs}
          <MobileDrawer title="Workspace tools" className="px-0" trigger={<PanelBottomIcon className="mx-auto size-5" />}>
            <WorkspacePanel hasGit={hasGit} workspaceId={workspaceId} projectId={projectId} sessions={sessions} />
          </MobileDrawer>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </WorkspaceBaseProvider>
  );

  return (
    <WorkspaceBaseProvider value={base}>
    <ResizablePanelGroup defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} orientation="horizontal" className="h-full">
      <ResizablePanel id="chat" defaultSize="70" minSize="45">
        <div className="flex h-full flex-col">
          {tabs}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="tools" defaultSize="30" minSize="20" maxSize="45">
        <div className="bg-sidebar/40 flex h-full flex-col">
          <div className="min-h-0 flex-1">
            {showComments && <CommentsPanel />}
            <div className={showComments ? "hidden" : "h-full"}><WorkspacePanel hasGit={hasGit} workspaceId={workspaceId} projectId={projectId} sessions={sessions} /></div>
          </div>
          <WorkspaceConsole key={workspaceId} workspaceId={workspaceId} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
    </WorkspaceBaseProvider>
  );
}
