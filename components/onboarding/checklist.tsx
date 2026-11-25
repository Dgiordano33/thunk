"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "./provider";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { newChatPath, projectPath, projectSectionPath } from "@/lib/routes";
type Progress = { projects: number; workspaces: number; sessions: number; notes: number; tasksOrRoutines: number };
export function Checklist({ projects }: { projects: SidebarProject[] }) {
  const { seen, markSeen } = useOnboarding();
  const dismissed = seen("checklist-dismissed");
  const pathname = usePathname();
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    if (dismissed) return;
    const controller = new AbortController();
    const load = () => fetch("/api/onboarding/progress", { cache: "no-store", signal: controller.signal }).then(async (r) => { if (r.ok) setProgress(await r.json()); }).catch(() => {});
    void load();
    const timer = setInterval(load, 15000);
    window.addEventListener("focus", load);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", load); };
  }, [dismissed, pathname]);
  if (dismissed || !progress || [progress.projects, progress.sessions, progress.notes, progress.tasksOrRoutines].every((n) => n > 0)) return null;
  const project = projects[0];
  const items = [
    ["Add a project", progress.projects, "/projects"],
    ["Run a session", progress.sessions, project ? newChatPath(project) : "/projects"],
    ["Write a note", progress.notes, "/notes"],
    ["Create a task or routine", progress.tasksOrRoutines, project ? projectSectionPath(projectPath(project), "tasks") : "/routines"],
  ] as const;
  return <div className="m-2 rounded-lg border bg-background p-3 text-xs" aria-label="Getting started"><details open><summary className="cursor-pointer font-medium">Getting started</summary><ol className="mt-2 space-y-2">{items.map(([label, count, href]) => <li key={label}><Link href={href} className="hover:underline"><span aria-label={count ? "Complete" : "Incomplete"}>{count ? "✓" : "○"}</span> {label}</Link></li>)}</ol></details><Button size="xs" variant="ghost" onClick={() => markSeen("checklist-dismissed")}>Dismiss checklist</Button></div>;
}
