"use client";

import { useState } from "react";
import Link from "next/link";
import { CivPanel } from "@/components/world/civ-panel";
import { FloatingWindow, WindowControls, useWindowHandle } from "@/components/world/floating-window";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskBoard } from "./task-board";

export function TasksOverview({ projects }: { projects: { id: string; name: string }[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const handle = useWindowHandle();
  return <FloatingWindow className="absolute inset-x-4 top-20 bottom-4 z-10 flex flex-col">
    <CivPanel className="min-h-0 flex-1" bodyClassName="flex h-full min-h-0 flex-col">
      <header {...handle} className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <h1 className="flex-1 text-lg font-semibold">Tasks</h1>
        {projects.length > 0 && <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger aria-label="Tasks project" className="w-48 max-w-[60%]"><SelectValue /></SelectTrigger>
          <SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
        </Select>}
        <WindowControls />
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {projectId ? <TaskBoard key={projectId} projectId={projectId} /> : <div className="space-y-3 p-6 text-sm">
          <p className="text-muted-foreground">Tasks belong to a project. Add a project to start tracking work.</p>
          <Link href="/projects" className="underline underline-offset-4">Open Projects</Link>
        </div>}
      </div>
    </CivPanel>
  </FloatingWindow>;
}
