"use client";

import { ArchiveIcon, ChevronLeftIcon, ChevronRightIcon, FolderGitIcon, FolderIcon, GitBranchIcon, HouseIcon, InboxIcon, LayoutGridIcon, ListChecksIcon, NotebookTextIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon, RepeatIcon, SettingsIcon, SlidersHorizontalIcon, type LucideIcon } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AmbientHub, SidebarActivity } from "@/components/ambient/ambient-hub";
import { CaptureTrigger } from "@/components/capture/capture-bar";
import { Hint } from "@/components/hint";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { useSidebarState } from "@/components/layout/shell-panels";
import { SidebarCanvases } from "@/components/layout/sidebar-canvases";
import { useCollapsed } from "@/components/layout/sidebar-collapsed";
import { COUNT, FOCUS, ROW } from "@/components/layout/sidebar-row";
import { Logo } from "@/components/logo";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { Checklist } from "@/components/onboarding/checklist";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import { isLocalWorkspace, sessionDot, sessionStatus, workspaceDisplayName } from "@/components/session/labels";
import { useTaskCounts } from "@/components/tasks/use-tasks";
import { SETTINGS_PATH } from "@/components/settings/sections";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspaceMenu } from "@/components/workspace/workspace-menu";
import { WORLD_SELECTION } from "@/components/world/selection";
import type { SessionMeta } from "@/lib/agent/types";
import type { CanvasSession } from "@/lib/board/types";
import { api } from "@/lib/client/api";
import { gitRepos } from "@/lib/projects/repos";
import { newChatPath, projectPath, projectSectionPath, projectSlugFromPath, PROJECTS_PATH, sessionPath, workspacePath } from "@/lib/routes";
import { useAmbient } from "@/lib/store/ambient-store";
import { useNotesEvents, useNotesFeed } from "@/lib/store/notes-store";
import { useNotifications } from "@/lib/store/notifications-store";
import { cn } from "@/lib/utils";

/** Sessions shown under a workspace before "Show more". */
const SESSION_LIMIT = 5;

type NavItem = { href: string; label: string; Icon: LucideIcon; active: boolean; count?: number; attention?: number };

function useNoteCounts() {
  useNotesEvents();
  const rev = useNotesFeed((s) => s.rev);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.noteCounts().then((r) => !cancelled && setCounts(r.counts)).catch(() => {});
    return () => { cancelled = true; };
  }, [rev]);
  return counts;
}

/** The project's sessions, newest first, refetched as you navigate and as sessions start. Live status comes from the activity feed. */
function useProjectSessions(projectId: string | undefined, pathname: string) {
  const live = useAmbient((s) => s.sessions);
  const liveKey = live.filter((s) => s.projectId === projectId).map((s) => s.id).join(",");
  const [loaded, setLoaded] = useState<{ projectId: string; sessions: SessionMeta[] } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.listSessions({ projectId }).then((r) => !cancelled && setLoaded({ projectId, sessions: r.sessions })).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, pathname, liveKey]);
  if (!projectId) return [];
  const byId = new Map<string, SessionMeta>();
  for (const s of loaded?.projectId === projectId ? loaded.sessions : []) byId.set(s.id, s);
  for (const s of live) if (s.projectId === projectId) byId.set(s.id, { ...byId.get(s.id), ...s });
  return [...byId.values()].filter((s) => s.origin?.kind !== "board").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function Attention({ count }: { count: number }) {
  return <span className="ml-auto rounded-sm bg-[var(--status-attention-soft)] px-1 font-mono text-[11px] leading-[18px] font-medium text-[var(--status-attention-ink)] tabular-nums">! {count}<span className="sr-only"> need attention</span></span>;
}

function NavList({ items, label }: { items: NavItem[]; label: string }) {
  return <ul aria-label={label} className="flex flex-col gap-0.5 px-2 pt-2">
    {items.map(({ href, label, Icon, active, count, attention }) => <li key={label} className={cn(ROW, active && WORLD_SELECTION)}>
      <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-[13px] font-medium", FOCUS)}>
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {attention ? <Attention count={attention} /> : count !== undefined && <span className={cn(COUNT, "ml-auto")}>{count}</span>}
      </Link>
    </li>)}
  </ul>;
}

/** Vanilla's sidebar: a general level (Projects, Inbox, Notes, Vault), and inside a project its own sections above each workspace's sessions. */
export function VanillaSidebar({ projects, canvases = {} }: { projects: SidebarProject[]; canvases?: Record<string, CanvasSession[]> }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const section = pathname.split("/")[1];
  const slug = projectSlugFromPath(pathname);
  // The Inbox filtered to one project is that project's Inbox, so it keeps the project level.
  const inboxProject = pathname === "/inbox" ? search.get("projectId") : null;
  const project = projects.find((p) => (slug ? p.slug === slug : p.id === inboxProject));
  const attentionTotal = useNotifications((s) => s.counts.action);
  const attentionByProject = useNotifications((s) => s.counts.byProject);
  const noteCounts = useNoteCounts();
  const taskCounts = useTaskCounts();
  const sessions = useProjectSessions(project?.id, pathname);
  const { collapsed, toggle } = useCollapsed();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { collapsed: rail, toggle: toggleSidebar } = useSidebarState();

  const base = project ? projectPath(project) : "";
  const tasks = project ? taskCounts[project.id] : undefined;
  const openTasks = (tasks?.project ?? 0) + Object.values(tasks?.byWorkspace ?? {}).reduce((sum, n) => sum + n, 0);
  const items: NavItem[] = project ? [
    { href: `/inbox?projectId=${project.id}`, label: "Inbox", Icon: InboxIcon, active: section === "inbox", attention: attentionByProject[project.id] },
    { href: projectSectionPath(base, "tasks"), label: "Tasks", Icon: ListChecksIcon, active: pathname === projectSectionPath(base, "tasks"), count: openTasks || undefined },
    { href: projectSectionPath(base, "library"), label: "Notes", Icon: NotebookTextIcon, active: pathname === projectSectionPath(base, "library"), count: noteCounts?.[project.id] },
    { href: projectSectionPath(base, "vault"), label: "Vault", Icon: ArchiveIcon, active: pathname === projectSectionPath(base, "vault") },
    { href: projectSectionPath(base, "workshop"), label: "Routines", Icon: RepeatIcon, active: pathname === projectSectionPath(base, "workshop") },
    { href: projectSectionPath(base, "center"), label: "Settings", Icon: SlidersHorizontalIcon, active: pathname === projectSectionPath(base, "center") },
  ] : [
    { href: PROJECTS_PATH, label: "Projects", Icon: LayoutGridIcon, active: pathname === PROJECTS_PATH },
    { href: "/inbox", label: "Inbox", Icon: InboxIcon, active: section === "inbox", attention: attentionTotal },
    { href: "/notes", label: "Notes", Icon: NotebookTextIcon, active: section === "notes", count: noteCounts ? Object.values(noteCounts).reduce((a, b) => a + b, 0) : undefined },
    { href: "/vault", label: "Vault", Icon: ArchiveIcon, active: section === "vault" },
  ];

  if (rail) {
    const railItem = (active: boolean) => cn("text-muted-foreground hover:text-foreground hover:bg-sidebar-accent relative flex size-9 items-center justify-center rounded-md transition-colors", FOCUS, active && WORLD_SELECTION);
    return (
      <nav aria-label="Sidebar" className="bg-sidebar text-sidebar-foreground flex h-full flex-col items-center gap-1 py-3">
        <AmbientHub projects={projects} variant="rail" />
        <CaptureTrigger variant="rail" />
        <div className="bg-sidebar-border my-1 h-px w-6" />
        {project && <Hint label="All projects" side="right"><Link href={PROJECTS_PATH} aria-label="All projects" className={railItem(false)}><ChevronLeftIcon className="size-4" /></Link></Hint>}
        {items.map(({ href, label, Icon, active, attention }) => <Hint key={label} label={attention ? `${label} · ${attention} need attention` : label} side="right">
          <Link href={href} aria-label={attention ? `${label}, ${attention} need attention` : label} aria-current={active ? "page" : undefined} className={railItem(active)}>
            <Icon className="size-4" aria-hidden="true" />
            {!!attention && <span className="absolute -top-0.5 -right-1 rounded-sm bg-[var(--status-attention-soft)] px-0.5 font-mono text-[9px] leading-3 font-medium text-[var(--status-attention-ink)] tabular-nums">{attention > 99 ? "99+" : attention}</span>}
          </Link>
        </Hint>)}
        <div className="flex-1" />
        <Hint label="Routines" side="right"><Link href="/routines" aria-label="Routines" className={railItem(section === "routines")}><RepeatIcon className="size-4" /></Link></Hint>
        <Hint label="Settings" keys="⌘," side="right"><Link href={SETTINGS_PATH} aria-label="Settings" className={railItem(section === "settings")}><SettingsIcon className="size-4" /></Link></Hint>
        <Hint label="Expand sidebar" keys={"⌘\\"} side="right"><button type="button" onClick={toggleSidebar} aria-label="Expand sidebar" className={railItem(false)}><PanelLeftOpenIcon className="size-4" /></button></Hint>
      </nav>
    );
  }

  const ProjectIcon = project && gitRepos(project).length ? FolderGitIcon : FolderIcon;
  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 pt-4 pr-2 pb-3 pl-4">
        <Link href={PROJECTS_PATH} className={cn("flex items-center", FOCUS)}><span className="sr-only">Thunk</span><Logo className="h-7 w-auto" /></Link>
        <AmbientHub projects={projects} />
      </div>
      <div className="px-2"><CaptureTrigger variant="sidebar" /></div>

      {!project && <>
        <NavList items={items} label="General" />
        <SidebarActivity projects={projects} />
        <div className="flex-1" />
      </>}

      {project && <>
        <div className="px-2 pt-2">
          <Link href={PROJECTS_PATH} className={cn("text-muted-foreground hover:text-foreground flex items-center gap-1 px-1 py-1 text-xs", FOCUS)}><ChevronLeftIcon className="size-3.5" aria-hidden="true" />All projects</Link>
          <div className={cn(ROW, "mt-1", pathname === base && WORLD_SELECTION)}>
            <Link href={base} title={[project.name, ...project.repos.map((r) => r.path)].join("\n")} aria-current={pathname === base ? "page" : undefined} className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2", FOCUS)}>
              <ProjectIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <span className="truncate text-sm font-semibold">{project.name}</span>
            </Link>
            <Button size="icon-xs" variant="ghost" asChild><Link href={newChatPath(project)} aria-label={`New chat in ${project.name}`} title="New chat" className={FOCUS}><PlusIcon /></Link></Button>
          </div>
        </div>
        <NavList items={items} label={project.name} />

        <div className="flex items-center justify-between pt-3 pr-2 pb-1 pl-4">
          <h2 className="text-muted-foreground text-xs font-medium">Workspaces</h2>
          <NewWorkspaceButton compact projectId={project.id} projectSlug={project.slug} projectName={project.name} repos={project.repos} />
        </div>
        {/* Radix wraps content in a display:table div that grows to fit, which defeats truncation. */}
        <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
          <ul className="flex flex-col gap-0.5 px-2 pb-3">
            {project.workspaces.length === 0 && <li className="text-muted-foreground px-2 py-1.5 text-xs">No workspaces yet.</li>}
            {project.workspaces.map((w) => {
              const open = !collapsed[w.id];
              const path = workspacePath(project, w);
              const name = workspaceDisplayName(w);
              const own = sessions.filter((s) => s.workspaceId === w.id);
              const activeSession = own.find((s) => pathname === sessionPath(project, w, s.id));
              const shown = expanded[w.id] ? own : own.filter((s, i) => i < SESSION_LIMIT || s === activeSession);
              const inWorkspace = pathname === path || pathname.startsWith(`${path}/`);
              const KindIcon = isLocalWorkspace(w) ? HouseIcon : GitBranchIcon;
              return <li key={w.id}>
                <div className={cn(ROW, "pl-0.5", inWorkspace && !(open && activeSession) && WORLD_SELECTION)}>
                  <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${name}`} aria-expanded={open} onClick={() => toggle(w.id, open)} className={cn("text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center", FOCUS)}>
                    <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                  </button>
                  <Link href={path} title={isLocalWorkspace(w) ? `${w.name}: works directly in ${w.cwd}, no worktree` : `${w.name}\n${w.cwd}`} className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5", FOCUS)}>
                    <KindIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate text-[13px] font-medium">{name}</span>
                  </Link>
                  <span className="sidebar-row-actions flex shrink-0 items-center gap-0.5">
                    <Button size="icon-xs" variant="ghost" asChild><Link href={newChatPath(project, w)} aria-label={`New session in ${name}`} title="New session" className={FOCUS}><PlusIcon /></Link></Button>
                    <WorkspaceMenu project={project} workspace={w} label={name} />
                  </span>
                  {w.sessionCount > 0 && <span className={COUNT} aria-label={`${w.sessionCount} session${Number(w.sessionCount) === 1 ? "" : "s"}`}>{w.sessionCount}</span>}
                </div>
                {open && shown.length > 0 && <ul aria-label={`${name} sessions`} className="mt-0.5 flex flex-col gap-0.5">
                  {shown.map((s) => {
                    const active = s === activeSession;
                    return <li key={s.id} className={cn(ROW, active && WORLD_SELECTION)}>
                      <Link href={sessionPath(project, w, s.id)} aria-current={active ? "page" : undefined} title={s.title || "Untitled session"} className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-8", FOCUS)}>
                        <span className={cn("size-1.5 shrink-0 rounded-full", sessionDot(s))} role="img" aria-label={sessionStatus(s)} title={sessionStatus(s)} />
                        <span className={cn("truncate text-[13px]", !active && "text-muted-foreground")}>{s.title || "Untitled session"}</span>
                      </Link>
                    </li>;
                  })}
                  {own.length > shown.length && <li><button type="button" onClick={() => setExpanded((e) => ({ ...e, [w.id]: true }))} className={cn("text-muted-foreground hover:text-foreground w-full py-1 pl-8 text-left text-xs", FOCUS)}>Show {own.length - shown.length} more</button></li>}
                </ul>}
              </li>;
            })}
          </ul>
          {canvases[project.id] && <div className="px-2 pb-3"><SidebarCanvases project={project} canvases={canvases[project.id]} pathname={pathname} /></div>}
        </ScrollArea>
      </>}

      <Checklist projects={projects} />
      <div className="flex items-center gap-1 border-t px-2 py-2">
        <Button asChild variant="ghost" size="sm" className="min-w-0 flex-1 justify-start text-xs"><Link href={SETTINGS_PATH}><SettingsIcon /> Settings</Link></Button>
        <Hint label="Routines" side="top"><Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground"><Link href="/routines" aria-label="Routines"><RepeatIcon /></Link></Button></Hint>
        <Hint label="Collapse sidebar" keys={"⌘\\"} side="top"><Button variant="ghost" size="icon-sm" className="text-muted-foreground hidden md:inline-flex" onClick={toggleSidebar} aria-label="Collapse sidebar"><PanelLeftCloseIcon /></Button></Hint>
      </div>
    </div>
  );
}
