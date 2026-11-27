"use client";

import { GitBranchIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import { StatusBadge } from "@/components/space/status";
import { Button } from "@/components/ui/button";
import { relativeTime, workspaceLabel } from "@/components/session/labels";
import type { SessionMeta } from "@/lib/agent/types";
import type { Project, WorkspaceSummary } from "@/lib/projects/types";
import { workspaceActivity } from "@/lib/ambient/summary";
import { useAmbient } from "@/lib/store/ambient-store";
import { newChatPath, projectPath, sessionPath, workspacePath } from "@/lib/routes";

export function VanillaProject({ project, workspaces, sessions, panel, children }: {
  project: Project; workspaces: WorkspaceSummary[]; sessions: SessionMeta[];
  panel: React.ReactNode; children?: React.ReactNode;
}) {
  const live = useAmbient(s => s.sessions);
  const base = projectPath(project);
  const recent = sessions.filter(s => s.origin?.kind !== "board").slice(0, 12);
  return <div className="flex h-full min-h-0 flex-col">
    <header className="shrink-0 border-b px-6 pt-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><h1 className="break-words text-2xl font-semibold tracking-tight">{project.name}</h1><p className="mt-1 text-sm text-muted-foreground">{project.repos.map(r => r.name).join(" · ") || "Project workspace"}</p></div>
        <div className="flex flex-wrap gap-2"><NewWorkspaceButton projectId={project.id} projectSlug={project.slug} projectName={project.name} repos={project.repos} /><Button asChild><Link href={newChatPath(project)}><PlusIcon />New chat</Link></Button></div>
      </div>
    </header>
    {panel ? <div className="min-h-0 flex-1 p-6 lg:px-8">{panel}</div> : <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-8">
      <section aria-label="Workspaces">
        <h2 className="mb-3 text-sm font-semibold">Workspaces</h2>
        {workspaces.length > 0 && <ul className="divide-y overflow-hidden rounded-lg border bg-card">{workspaces.map(w => {
          const activity = workspaceActivity(live, w.id);
          return <li key={w.id} className="flex items-center gap-3 pr-4 hover:bg-muted/40">
            <Link href={workspacePath(project, w)} className="flex min-w-0 flex-1 items-center gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><GitBranchIcon className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><span className="block truncate text-sm font-medium">{workspaceLabel(w)}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{w.branch ?? "Project files"} · {w.sessionCount} {Number(w.sessionCount) === 1 ? "session" : "sessions"}</span></div></Link>
            {activity && <StatusBadge activity={activity} />}<Button asChild variant="ghost" size="sm"><Link href={`${base}?ws=${w.id}`} aria-label={`${workspaceLabel(w)} details`}>Details</Link></Button>
          </li>;
        })}</ul>}
        {workspaces.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Start a chat to create a workspace, or add one for a separate effort.</p>}
      </section>
      <section aria-label="Recent sessions" className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Recent sessions</h2>
        {recent.length ? <ul className="divide-y">{recent.map(s => {
          const ws = workspaces.find(w => w.id === s.workspaceId);
          if (!ws) return null;
          return <li key={s.id}><Link href={sessionPath(project, ws, s.id)} className="flex items-center gap-3 rounded-md px-2 py-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"><MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm">{s.title || "Untitled session"}</span><span className="text-xs text-muted-foreground">{relativeTime(s.createdAt)}</span></Link></li>;
        })}</ul> : <p className="py-5 text-sm text-muted-foreground">Your conversations will appear here when you start a chat.</p>}
      </section>
    </main>}
    {children}
  </div>;
}
