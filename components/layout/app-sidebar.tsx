"use client";
import { useLook } from "@/components/look-context";
import { ArchiveIcon, LayoutGridIcon, RepeatIcon } from "lucide-react";
import { Checklist } from "@/components/onboarding/checklist";

import { projectSectionPath } from "@/lib/routes";

import { WORLD_SELECTION } from "@/components/world/selection";

import { BotIcon, ChevronRightIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SettingsIcon, FolderGitIcon, FolderIcon, GitBranchIcon, HouseIcon, InboxIcon, PlusIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AmbientHub, SidebarActivity } from "@/components/ambient/ambient-hub";
import { CaptureTrigger } from "@/components/capture/capture-bar";
import { api } from "@/lib/client/api";
import { useNotesEvents, useNotesFeed } from "@/lib/store/notes-store";
import { refreshNotifications, useNotifications } from "@/lib/store/notifications-store";
import { useTaskCounts } from "@/components/tasks/use-tasks";
import { PixelIcon } from "@/components/world/pixel-icon";
import { SETTINGS_PATH } from "@/components/settings/sections";
import { workspaceActivity } from "@/lib/ambient/summary";
import { useAmbient } from "@/lib/store/ambient-store";
import { Logo } from "@/components/logo";
import { Hint } from "@/components/hint";
import { useSidebarState } from "@/components/layout/shell-panels";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import { isLocalWorkspace, workspaceDisplayName } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspaceMenu } from "@/components/workspace/workspace-menu";
import { canvasIdFromPath, SidebarCanvases } from "@/components/layout/sidebar-canvases";
import { COUNT, FOCUS, ROW } from "@/components/layout/sidebar-row";
import type { CanvasSession } from "@/lib/board/types";
import { gitRepos } from "@/lib/projects/repos";
import type { ProjectSummary, WorkspaceSummary } from "@/lib/projects/types";
import { projectSlugFromPath, isProjectPath, PROJECTS_PATH, projectPath, workspacePath, newChatPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

export type SidebarProject = ProjectSummary & { defaultSessionCount?: number; workspaces: (WorkspaceSummary & { worker?: boolean })[] };

const COLLAPSED_KEY = "thunk.sidebar.collapsed";
/** Collapsed projects, remembered across reloads. Read through useSyncExternalStore so hydration agrees with the server. */
const collapsedListeners = new Set<() => void>();
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) ?? "{}"; } catch { return "{}"; } };
const subscribeCollapsed = (listener: () => void) => {
  collapsedListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { collapsedListeners.delete(listener); window.removeEventListener("storage", listener); };
};
function setProjectCollapsed(current: Record<string, boolean>, id: string, collapse: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ ...current, [id]: collapse })); } catch { /* Storage is optional. */ }
  collapsedListeners.forEach((listener) => listener());
}
const ACTIVITY_DOT: Record<string, string> = {
  Running: "bg-[var(--status-running)]",
  "Needs attention": "bg-[var(--status-attention-ink)]",
  "Session error": "bg-[var(--status-error)]",
};

/** The one attention mark: glyph plus count, in the attention ink (design.md, status tokens). */
function AttentionCount({ count }: { count: number }) {
  return <span className="rounded-sm bg-[var(--status-attention-soft)] px-1 font-mono text-[11px] leading-[18px] font-medium text-[var(--status-attention-ink)] tabular-nums">! {count}</span>;
}

const VANILLA_LINKS = [
  { href: PROJECTS_PATH, label: "All projects", Icon: LayoutGridIcon },
  { href: "/routines", label: "Routines", Icon: RepeatIcon },
  { href: "/vault", label: "Vault", Icon: ArchiveIcon },
];

function VanillaLinks({ rail = false }: { rail?: boolean }) {
  const { look } = useLook();
  const pathname = usePathname();
  if (look !== "vanilla") return null;
  return <>{VANILLA_LINKS.map(({ href, label, Icon }) => {
    const active = pathname === href;
    const link = <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={cn("text-muted-foreground hover:text-foreground hover:bg-sidebar-accent flex items-center rounded-md", FOCUS, active && WORLD_SELECTION, rail ? "size-9 justify-center" : "gap-2 px-2 py-1.5 text-[13px] font-medium")}><Icon className="size-4 shrink-0" />{!rail && label}</Link>;
    return rail ? <Hint key={href} label={label} side="right">{link}</Hint> : <li key={href}>{link}</li>;
  })}</>;
}

export function AppSidebar({ projects, canvases = {} }: { projects: SidebarProject[]; canvases?: Record<string, CanvasSession[]> }) {
  const notificationCounts = useNotifications((s) => s.counts.byProject);
  const attentionTotal = useNotifications((s) => s.counts.action);
  const notificationsLoaded = useNotifications((s) => s.loaded);
  const notificationError = useNotifications((s) => s.error);
  const taskCounts = useTaskCounts();
  const sessions = useAmbient((s) => s.sessions);
  const pathname = usePathname();
  const section = pathname.split("/")[1];
  const workspaceSlug = pathname.startsWith("/projects/") ? undefined : pathname.split("/")[2];
  // A canvas highlights its own row, not the project. Within a project, the town (/{project}) highlights the project and its pages (/{project}/{workspace}/…) the workspace.
  const activeProject = isProjectPath(pathname) ? projects.find((p) => p.slug === projectSlugFromPath(pathname)) : undefined;
  const activeProjectId = activeProject && canvasIdFromPath(pathname, activeProject.slug) === null && (!workspaceSlug || !activeProject.workspaces.some(w => w.slug === workspaceSlug && w.visibility !== "project" && w.slug !== "main")) ? activeProject.id : undefined;
  const activeWorkspaceId = workspaceSlug ? activeProject?.workspaces.find((w) => w.slug === workspaceSlug)?.id : undefined;
  const collapsedRaw = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => "{}");
  const collapsed = useMemo<Record<string, boolean>>(() => { try { return JSON.parse(collapsedRaw); } catch { return {}; } }, [collapsedRaw]);
  const toggle = (id: string, collapse: boolean) => setProjectCollapsed(collapsed, id, collapse);
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
  const { collapsed: rail, toggle: toggleSidebar } = useSidebarState();

  if (rail) {
    const railItem = (active: boolean) => cn("text-muted-foreground hover:text-foreground hover:bg-sidebar-accent relative flex size-9 items-center justify-center rounded-md transition-colors", FOCUS, active && WORLD_SELECTION);
    return (
      <nav aria-label="Sidebar" className="bg-sidebar text-sidebar-foreground flex h-full flex-col items-center gap-1 py-3">
        <AmbientHub projects={projects} variant="rail" />
        <CaptureTrigger variant="rail" />
        <div className="bg-sidebar-border my-1 h-px w-6" />
        <Hint label={attentionTotal > 0 ? `Inbox · ${attentionTotal} need attention` : "Inbox"} side="right">
          <Link href="/inbox" aria-label={attentionTotal > 0 ? `Inbox, ${attentionTotal} need attention` : "Inbox"} className={railItem(section === "inbox")}>
            <InboxIcon className="size-4" aria-hidden="true" />
            {!notificationError && attentionTotal > 0 && (
              <span className="absolute -top-0.5 -right-1 rounded-sm bg-[var(--status-attention-soft)] px-0.5 font-mono text-[9px] leading-3 font-medium text-[var(--status-attention-ink)] tabular-nums backdrop-blur-sm">{attentionTotal > 99 ? "99+" : attentionTotal}</span>
            )}
          </Link>
        </Hint>
        <Hint label="Library" side="right">
          <Link href="/notes" aria-label="Library" className={railItem(section === "notes")}><PixelIcon name="scroll" className="size-4" /></Link>
        </Hint>
        <VanillaLinks rail />
        <div className="flex-1" />
        <Hint label="Settings" keys="⌘," side="right">
          <Link href={SETTINGS_PATH} aria-label="Settings" className={railItem(section === "settings")}><SettingsIcon className="size-4" /></Link>
        </Hint>
        <Hint label="Expand sidebar" keys={"⌘\\"} side="right">
          <button type="button" onClick={toggleSidebar} aria-label="Expand sidebar" className={railItem(false)}><PanelLeftOpenIcon className="size-4" /></button>
        </Hint>
      </nav>
    );
  }

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 pt-4 pr-2 pb-3 pl-4">
        <Link href={PROJECTS_PATH} className={cn("flex items-center", FOCUS)}>
          <span className="sr-only">Thunk</span>
          <Logo className="h-7 w-auto" />
        </Link>
        <AmbientHub projects={projects} />
      </div>

      <div className="px-2"><CaptureTrigger variant="sidebar" /></div>

      <ul className="flex flex-col gap-0.5 px-2 pt-2">
        <li className={cn(ROW, section === "inbox" && WORLD_SELECTION)}>
          <Link href="/inbox" className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-[13px] font-medium", FOCUS)}>
            <InboxIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Inbox</span>
            {!notificationError && attentionTotal > 0 && (
              <span className="ml-auto"><AttentionCount count={attentionTotal} /><span className="sr-only"> need attention</span></span>
            )}
            {!notificationError && notificationsLoaded && attentionTotal === 0 && <span className={cn(COUNT, "ml-auto")}>All clear</span>}
          </Link>
          {notificationError && (
            <button type="button" onClick={() => void refreshNotifications()} title={notificationError} className={cn("text-destructive shrink-0 px-1 text-[11px] hover:underline", FOCUS)}>
              Offline · Retry
            </button>
          )}
        </li>
        <li className={cn(ROW, section === "notes" && WORLD_SELECTION)}>
          <Link href="/notes" className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-[13px] font-medium", FOCUS)}>
            <PixelIcon name="scroll" className="size-4 shrink-0" />
            <span className="truncate">Library</span>
            {counts && <span className={cn(COUNT, "ml-auto")} aria-label={`${totalNotes} notes`}>{totalNotes}</span>}
          </Link>
        </li>
        <VanillaLinks />
      </ul>

      <SidebarActivity projects={projects} />

      <div className="flex items-center justify-between pt-3 pr-2 pb-1 pl-4">
        <h2 className="text-muted-foreground pixel text-[11px] tracking-widest uppercase">Projects</h2>
        <Button size="icon-xs" variant="ghost" aria-label="Add project" asChild>
          <Link href={PROJECTS_PATH}>
            <PlusIcon />
          </Link>
        </Button>
      </div>

      {/* Radix wraps content in a display:table div that grows to fit, which defeats truncation and pushed rows past the edge. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <ul className="flex flex-col gap-0.5 px-2 pb-3">
          {projects.length === 0 && <li className="text-muted-foreground px-2 py-1.5 text-xs">No projects yet.</li>}
          {projects.map((p) => {
            const open = !collapsed[p.id];
            const visibleWorkspaces = p.workspaces.filter(w => w.visibility !== "project" && w.slug !== "main");
            const visibleIds = new Set(visibleWorkspaces.map(w => w.id));
            const defaultSessions = sessions.filter(s => s.projectId === p.id && !visibleIds.has(s.workspaceId));
            const activity = workspaceActivity(defaultSessions.map(s => ({ ...s, workspaceId: p.id })), p.id);
            const chatCount = p.defaultSessionCount ?? Math.max(0, p.sessionCount - visibleWorkspaces.reduce((n, w) => n + Number(w.sessionCount), 0));
            const tasks = taskCounts[p.id];
            const openTasks = (tasks?.project ?? 0) + Object.values(tasks?.byWorkspace ?? {}).reduce((sum, count) => sum + count, 0);
            const attention = notificationCounts[p.id] ?? 0;
            const notes = noteCounts.get(p.id) ?? 0;
            const ProjectIcon = gitRepos(p).length ? FolderGitIcon : FolderIcon;
            const tasksLink = (
              <Link href={projectSectionPath(projectPath(p), "tasks")} aria-label={`${p.name} open tasks (${openTasks})`} title={`${openTasks} open tasks`} className={cn(COUNT, "hover:text-foreground flex items-center gap-0.5 px-0.5", FOCUS)}>
                <PixelIcon name="checklist" className="size-3" />{openTasks}
              </Link>
            );
            return (
              <li key={p.id}>
                <div className={cn(ROW, "pl-0.5", p.id === activeProjectId && WORLD_SELECTION)}>
                  <button
                    type="button"
                    aria-label={`${open ? "Collapse" : "Expand"} ${p.name}`}
                    aria-expanded={open}
                    onClick={() => toggle(p.id, open)}
                    className={cn("text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center", FOCUS)}
                  >
                    <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                  </button>
                  <Link href={projectPath(p)} title={[p.name, ...p.repos.map((r) => r.path)].join("\n")} className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5", FOCUS)}>
                    <ProjectIcon className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate text-[13px] font-medium">{p.name}</span>
                  </Link>
                  <span className="sidebar-row-actions flex shrink-0 items-center gap-0.5">
                    {notes > 0 && (
                      <Link
                        href={projectSectionPath(projectPath(p), "library")}
                        title={`${notes} notes`}
                        aria-label={`${p.name} notes (${notes})`}
                        className={cn(COUNT, "hover:text-foreground flex items-center gap-0.5 px-0.5", FOCUS)}
                      >
                        <PixelIcon name="scroll" className="size-3" />{notes}
                      </Link>
                    )}
                    {attention > 0 && openTasks > 0 && tasksLink}
                    <Button size="icon-xs" variant="ghost" asChild><Link href={newChatPath(p)} aria-label={`New chat in ${p.name}`} title="New chat" className={FOCUS}><PlusIcon /></Link></Button>
                    <NewWorkspaceButton compact projectId={p.id} projectSlug={p.slug} projectName={p.name} repos={p.repos} />
                  </span>
                  {attention > 0 ? (
                    <Link href={`/inbox?projectId=${p.id}`} aria-label={`${p.name}: ${attention} notifications need attention`} className={cn("shrink-0", FOCUS)}>
                      <AttentionCount count={attention} />
                    </Link>
                  ) : openTasks > 0 && tasksLink}
                  {activity && <span className={cn("size-2 shrink-0 rounded-full", ACTIVITY_DOT[activity] ?? ACTIVITY_DOT.Running)} role="img" aria-label={activity} title={activity} />}
                  {chatCount > 0 && <span className={COUNT} aria-label={`${chatCount} chats`}>{chatCount}</span>}
                </div>

                {open && (
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {visibleWorkspaces.map((w) => {
                      const activity = workspaceActivity(sessions, w.id);
                      const worker = w.worker || sessions.some((s) => s.workspaceId === w.id && s.origin?.kind === "worker");
                      const wsTasks = tasks?.byWorkspace[w.id] ?? 0;
                      const KindIcon = isLocalWorkspace(w) ? HouseIcon : GitBranchIcon;
                      return (
                      <li key={w.id} className={cn(ROW, w.id === activeWorkspaceId && WORLD_SELECTION)}>
                        <Link
                          href={workspacePath(p, w)}
                          title={
                            isLocalWorkspace(w)
                              ? `${w.name}: works directly in ${w.cwd}, no worktree`
                              : `${w.name}\n${w.cwd}`
                          }
                          className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-8", FOCUS)}
                        >
                          <KindIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate text-[13px]">{workspaceDisplayName(w)}</span>
                          {worker && <BotIcon role="img" aria-label="Has worker sessions" className="text-muted-foreground size-3 shrink-0"><title>Has worker sessions</title></BotIcon>}
                          {activity && (
                            <span className={cn("size-2 shrink-0 rounded-full", ACTIVITY_DOT[activity])} role="img" aria-label={activity} title={activity} />
                          )}
                        </Link>
                        <span className="sidebar-row-actions flex shrink-0 items-center gap-0.5">
                          {wsTasks > 0 && <Link href={`${workspacePath(p, w)}?tab=tasks`} aria-label={`${workspaceDisplayName(w)} open tasks (${wsTasks})`} title="Open tasks" className={cn(COUNT, "hover:text-foreground flex items-center gap-0.5 px-0.5", FOCUS)}><PixelIcon name="checklist" className="size-3" />{wsTasks}</Link>}
                          <WorkspaceMenu project={p} workspace={w} label={workspaceDisplayName(w)} />
                        </span>
                        {w.sessionCount > 0 && (
                          <span
                            className={COUNT}
                            title={`${w.sessionCount} session${w.sessionCount === 1 ? "" : "s"}`}
                            aria-label={`${w.sessionCount} session${w.sessionCount === 1 ? "" : "s"}`}
                          >
                            {w.sessionCount}
                          </span>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                )}
                {open && canvases[p.id] && <SidebarCanvases project={p} canvases={canvases[p.id]} pathname={pathname} />}
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      <Checklist projects={projects} />
      <div className="flex items-center gap-1 border-t px-2 py-2">
        <Button asChild variant="ghost" size="sm" className="min-w-0 flex-1 justify-start text-xs">
          <Link href={SETTINGS_PATH}><SettingsIcon /> Settings</Link>
        </Button>
        <Hint label="Collapse sidebar" keys={"⌘\\"} side="top">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hidden md:inline-flex" onClick={toggleSidebar} aria-label="Collapse sidebar"><PanelLeftCloseIcon /></Button>
        </Hint>
      </div>
    </div>
  );
}
