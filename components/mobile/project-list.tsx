"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { useTaskCounts } from "@/components/tasks/use-tasks";
import { api } from "@/lib/client/api";
import { projectPath } from "@/lib/routes";
import { useAmbient } from "@/lib/store/ambient-store";
import { useNotesFeed } from "@/lib/store/notes-store";

export function ProjectList({ projects }: { projects: SidebarProject[] }) {
  const sessions = useAmbient(s => s.sessions);
  const tasks = useTaskCounts();
  const rev = useNotesFeed(s => s.rev);
  const [notes, setNotes] = useState<Record<string, number>>({});
  useEffect(() => {
    let active = true;
    api.noteCounts().then(r => { if (active) setNotes(r.counts); }).catch(() => {});
    return () => { active = false; };
  }, [rev]);
  return <main className="h-dvh overflow-y-auto px-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))]">
    <h1 className="mb-4 text-xl">Projects</h1>
    <div className="space-y-3">{projects.map(p => {
      const active = sessions.filter(s => s.projectId === p.id);
      const waiting = active.filter(s => s.pending > 0).length;
      const running = active.filter(s => s.status === "running").length;
      const count = tasks[p.id];
      return <Link key={p.id} href={projectPath(p)} className="block rounded-lg border bg-background p-4">
        <h2 className="break-words font-medium">{p.name}</h2>
        <p className="text-sm text-muted-foreground">{p.workspaces.length} workspaces · {count ? count.project + Object.values(count.byWorkspace).reduce((a, b) => a + b, 0) : 0} tasks · {notes[p.id] ?? "…"} notes</p>
        <p className="mt-2 text-sm"><span className="text-emerald-600">●</span> {running} running · <span className="text-amber-600">●</span> {waiting} waiting</p>
      </Link>;
    })}{!projects.length && <p>Add a project from your desktop to get started.</p>}</div>
  </main>;
}
