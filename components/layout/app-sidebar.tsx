"use client";

import { ChevronRightIcon, FolderGitIcon, FolderIcon, GitBranchIcon, HouseIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  const pathname = usePathname();
  const [, section, activeId] = pathname.split("/");
  const activeProjectId = section === "p" ? activeId : undefined;
  const activeWorkspaceId = section === "w" ? activeId : undefined;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <Link href="/" className="flex items-center">
          <span className="sr-only">Thunk</span>
          <Logo className="h-7 w-auto" />
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
                  <NewWorkspaceButton
                    compact
                    projectId={p.id}
                    projectName={p.name}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-100"
                  />
                </div>

                {open && (
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {p.workspaces.map((w) => (
                      <li key={w.id} className="group/ws relative">
                        <Link
                          href={`/w/${w.id}`}
                          title={
                            isLocalWorkspace(w)
                              ? `Local: works directly in ${w.cwd}, no worktree`
                              : `${w.name}\n${w.cwd}`
                          }
                          className={cn(
                            "hover:bg-sidebar-accent flex items-center gap-2 rounded-md py-1.5 pr-8 pl-8 transition-colors",
                            w.id === activeWorkspaceId && "bg-sidebar-accent",
                          )}
                        >
                          {w.worktreePath ? (
                            <GitBranchIcon className="text-muted-foreground size-3.5 shrink-0" />
                          ) : (
                            <HouseIcon className="text-muted-foreground size-3.5 shrink-0" />
                          )}
                          <span className="truncate text-[13px]">{workspaceDisplayName(w)}</span>
                          {w.sessionCount > 0 && (
                            <span
                              className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums group-hover/ws:invisible group-has-[[data-state=open]]/ws:invisible"
                              title={`${w.sessionCount} session${w.sessionCount === 1 ? "" : "s"}`}
                              aria-label={`${w.sessionCount} session${w.sessionCount === 1 ? "" : "s"}`}
                            >
                              {w.sessionCount}
                            </span>
                          )}
                        </Link>
                        <WorkspaceMenu
                          workspace={w}
                          label={workspaceDisplayName(w)}
                          className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/ws:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
