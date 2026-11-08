"use client";

import { ChevronRightIcon, FolderGitIcon, FolderIcon, GitBranchIcon, HouseIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AmbientHub } from "@/components/ambient/ambient-hub";
import { api } from "@/lib/client/api";
import { useNotesEvents, useNotesFeed } from "@/lib/store/notes-store";
import { useTaskCounts } from "@/components/tasks/use-tasks";
import { PixelIcon } from "@/components/world/pixel-icon";
import { SettingsMenu } from "@/components/ambient/settings-menu";
import { workspaceActivity } from "@/lib/ambient/summary";
import { useAmbient } from "@/lib/store/ambient-store";
import { Logo } from "@/components/logo";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import { isLocalWorkspace, workspaceDisplayName } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspaceMenu } from "@/components/workspace/workspace-menu";
import type { ProjectSummary, WorkspaceSummary } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

export type SidebarProject = ProjectSummary & { workspaces: WorkspaceSummary[] };

export function AppSidebar({ projects }: { projects: SidebarProject[] }) {
  const taskCounts = useTaskCounts();
  const sessions = useAmbient((s) => s.sessions);
  const pathname = usePathname();
  const [, section, activeId] = pathname.split("/");
  const activeProjectId = section === "p" ? activeId : undefined;
  const activeWorkspaceId = section === "w" ? activeId : undefined;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useNotesEvents();
  const rev = useNotesFeed((s) => s.rev);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.noteCounts().then((r) => !cancelled && setCounts(r.counts)).catch(() => {});
    return () => { cancelled = true; };
  }, [rev]);
  const noteCounts = new Map(Object.entries(counts ?? {}));
  const totalNotes = [...noteCounts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <Link href="/" className="flex items-center">
          <span className="sr-only">Thunk</span>
          <Logo className="h-7 w-auto" />
        </Link>
      </div>

      <AmbientHub projects={projects} />

      <div className="px-2 pt-1">
        <Link
          href="/notes"
          className={cn(
            "hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
            section === "notes" && "bg-sidebar-accent",
          )}
        >
          <PixelIcon name="scroll" className="size-4 shrink-0" />
          Library
          {counts && <span className="text-muted-foreground ml-auto text-[11px] tabular-nums">{totalNotes}</span>}
        </Link>
      </div>

      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <h2 className="text-muted-foreground text-xs font-medium">Projects</h2>
        <Button size="icon-xs" variant="ghost" aria-label="Add project" asChild>
          <Link href="/">
            <PlusIcon />
          </Link>
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 px-2 pb-3">
          {projects.length === 0 && <li className="text-muted-foreground px-2 py-1.5 text-xs">No projects yet.</li>}
          {projects.map((p) => {
            const open = !collapsed[p.id];
            const tasks = taskCounts[p.id];
            const openTasks = (tasks?.project ?? 0) + Object.values(tasks?.byWorkspace ?? {}).reduce((sum, count) => sum + count, 0);
            const ProjectIcon = p.kind === "repo" ? FolderGitIcon : FolderIcon;
            return (
              <li key={p.id}>
                <div
                  className={cn(
                    "group hover:bg-sidebar-accent flex items-center gap-1 rounded-md pr-1 transition-colors",
                    p.id === activeProjectId && "bg-sidebar-accent",
                  )}
                >
                  <button
                    type="button"
                    aria-label={open ? "Collapse" : "Expand"}
                    aria-expanded={open}
                    onClick={() => setCollapsed((c) => ({ ...c, [p.id]: open }))}
                    className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center"
                  >
                    <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                  </button>
                  <Link href={`/p/${p.id}`} title={p.root} className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
                    <ProjectIcon className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate text-[13px] font-medium">{p.name}</span>
                  </Link>
                  {(noteCounts.get(p.id) ?? 0) > 0 && (
                    <Link
                      href={`/p/${p.id}?building=library`}
                      title={`${noteCounts.get(p.id)} notes`}
                      aria-label={`${p.name} notes (${noteCounts.get(p.id)})`}
                      className="text-muted-foreground hover:text-foreground hidden shrink-0 items-center gap-0.5 px-1 text-[11px] tabular-nums group-hover:flex focus-visible:flex"
                    >
                      <PixelIcon name="scroll" className="size-3" />
                      {noteCounts.get(p.id)}
                    </Link>
                  )}
                  {openTasks > 0 && <Link href={`/p/${p.id}?building=tasks`} aria-label={`${p.name} open tasks (${openTasks})`} title={`${openTasks} open tasks`} className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-0.5 px-1 text-[11px] tabular-nums"><PixelIcon name="checklist" className="size-3" />{openTasks}</Link>}
                  <NewWorkspaceButton
                    compact
                    projectId={p.id}
                    projectName={p.name}
                    repos={p.extraRepos}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-100"
                  />
                </div>

                {open && (
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {p.workspaces.map((w) => {
                      const activity = workspaceActivity(sessions, w.id);
                      return (
                      <li key={w.id} className="group/ws relative flex items-center pr-8">
                        <Link
                          href={`/w/${w.id}`}
                          title={
                            isLocalWorkspace(w)
                              ? `Local: works directly in ${w.cwd}, no worktree`
                              : `${w.name}\n${w.cwd}`
                          }
                          className={cn(
                            "hover:bg-sidebar-accent flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-1 pl-8 transition-colors",
                            w.id === activeWorkspaceId && "bg-sidebar-accent",
                          )}
                        >
                          {w.worktreePath ? (
                            <GitBranchIcon className="text-muted-foreground size-3.5 shrink-0" />
                          ) : (
                            <HouseIcon className="text-muted-foreground size-3.5 shrink-0" />
                          )}
                          <span className="truncate text-[13px]">{workspaceDisplayName(w)}</span>
                          {activity && (
                            <span className={cn("size-2 shrink-0 rounded-full", activity === "Running" ? "bg-sky-500" : "bg-amber-500")} role="img" aria-label={activity} title={activity} />
                          )}
                        </Link>
                        {(tasks?.byWorkspace[w.id] ?? 0) > 0 && <Link href={`/w/${w.id}?tab=tasks`} aria-label={`${workspaceDisplayName(w)} open tasks (${tasks?.byWorkspace[w.id]})`} title="Open tasks" className="text-muted-foreground hover:text-foreground mr-2 flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums"><PixelIcon name="checklist" className="size-3" />{tasks?.byWorkspace[w.id]}</Link>}
                          {w.sessionCount > 0 && (
                            <span
                              className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums group-hover/ws:invisible group-has-[[data-state=open]]/ws:invisible"
                              title={`${w.sessionCount} session${w.sessionCount === 1 ? "" : "s"}`}
                              aria-label={`${w.sessionCount} session${w.sessionCount === 1 ? "" : "s"}`}
                            >
                              {w.sessionCount}
                            </span>
                          )}
                        <WorkspaceMenu
                          workspace={w}
                          label={workspaceDisplayName(w)}
                          className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/ws:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        />
                      </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      <SettingsMenu projects={projects} />
    </div>
  );
}
