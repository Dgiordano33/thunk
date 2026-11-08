"use client";

import { usePathname } from "next/navigation";
import { CommentsPanel } from "@/components/comments/comments-panel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { SessionMeta } from "@/lib/agent/types";
import { useUi } from "@/lib/store/ui-store";
import { WorkspaceConsole } from "./workspace-console";
import { WorkspacePanel } from "./workspace-panel";

/** Session tabs and the open page on the left; workspace-wide panel (or the open session's comments) over the workspace console on the right. */
export function WorkspaceShell({
  workspaceId,
  projectId,
  sessions,
  tabs,
  children,
}: {
  workspaceId: string;
  projectId: string;
  sessions: SessionMeta[];
  tabs: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const commentsOpen = useUi((s) => s.commentsOpen);
  const showComments = commentsOpen && pathname.includes("/s/");

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize="70" minSize="45">
        <div className="flex h-full flex-col">
          {tabs}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="30" minSize="20" maxSize="45">
        <div className="bg-sidebar/40 flex h-full flex-col">
          <div className="min-h-0 flex-1">
            {showComments ? <CommentsPanel /> : <WorkspacePanel workspaceId={workspaceId} projectId={projectId} sessions={sessions} />}
          </div>
          <WorkspaceConsole key={workspaceId} workspaceId={workspaceId} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
