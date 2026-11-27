"use client";

import { useState } from "react";
import { ArrowUpRightIcon, FolderIcon, SearchIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { AddProjectForm } from "@/components/home/add-project-form";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { StatusBadge } from "@/components/space/status";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/components/session/labels";
import { useAmbient } from "@/lib/store/ambient-store";
import { cityActivity } from "@/lib/world/cities";
import { projectPath } from "@/lib/routes";

export function VanillaProjects({ projects, durable }: { projects: SidebarProject[]; durable: boolean }) {
  const [query, setQuery] = useState("");
  const sessions = useAmbient(s => s.sessions);
  const filtered = projects.filter(p => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">Projects</h1><p className="mt-1 text-sm text-muted-foreground">Your work, context, and agents in one place.</p></div>
        <AddProjectForm />
      </header>
      {!durable && <p className="mb-6 rounded-md border p-3 text-sm text-muted-foreground">Thunk is running without a database. Projects, tasks, routines, and session history won&apos;t survive a server restart. Notes, vault files, and memory remain on disk.</p>}
      {projects.length > 0 ? <>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="relative w-full max-w-xs"><SearchIcon aria-hidden="true" className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="Search projects" placeholder="Search projects…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" /></div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{filtered.length} {filtered.length === 1 ? "project" : "projects"}</span>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_120px] gap-4 border-b bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground lg:grid-cols-[minmax(0,1fr)_120px_100px_100px]">
            <span>Project</span><span>Status</span><span className="hidden lg:block">Workspaces</span><span className="hidden lg:block">Updated</span>
          </div>
          <ul className="divide-y">{filtered.map(p => {
            const activity = cityActivity(sessions, p.id);
            return <li key={p.id}><Link href={projectPath(p)} className="group grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4 px-5 py-4 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:grid-cols-[minmax(0,1fr)_120px_100px_100px]">
              <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background"><FolderIcon className="size-4 text-muted-foreground" /></span><div className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{p.name}</span><ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" /></span><p className="mt-0.5 truncate text-xs text-muted-foreground">{p.repos.map(r => r.name).join(" · ") || "No repositories"}</p></div></div>
              <div>{activity ? <StatusBadge activity={activity} /> : <span className="text-xs text-muted-foreground">Idle</span>}</div>
              <span className="hidden text-sm text-muted-foreground tabular-nums lg:block">{p.workspaces.length}</span>
              <span className="hidden text-xs text-muted-foreground lg:block">{relativeTime(p.lastActivityAt ?? p.updatedAt)}</span>
            </Link></li>;
          })}</ul>
          {filtered.length === 0 && <p className="px-5 py-12 text-center text-sm text-muted-foreground">No projects match “{query}”.</p>}
        </div>
      </> : <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-20 text-center"><FolderIcon className="mb-4 size-8 text-muted-foreground" /><h2 className="text-base font-medium">Add your first project</h2><p className="mt-2 mb-6 max-w-sm text-sm text-muted-foreground">Clone a repository, open a folder, or start fresh. Your chats, notes, and tasks stay together here.</p><AddProjectForm /></div>}
    </main>
  );
}
