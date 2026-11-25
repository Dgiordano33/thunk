"use client";
import { PlusIcon, ShapesIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { NewCanvasDialog } from "@/components/board/canvas-name-dialog";
import { Button } from "@/components/ui/button";
import { WORLD_SELECTION } from "@/components/world/selection";
import { CANVAS_STATUS_LABEL } from "@/lib/board/status";
import type { CanvasSession } from "@/lib/board/types";
import { useAmbient } from "@/lib/store/ambient-store";
import { canvasPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** The board a pathname shows, when it is one of this project's canvases. */
export function canvasIdFromPath(pathname: string, slug: string) {
  const [, project, section, board] = pathname.split("/");
  return project === slug && section === "canvas" ? board ? decodeURIComponent(board) : "main" : null;
}

/** A project's canvases in the sidebar, each with its agent's status, and a way to start another. */
export function SidebarCanvases({ project, canvases, pathname }: { project: { id: string; slug: string; name: string }; canvases: CanvasSession[]; pathname: string }) {
  const live = useAmbient((s) => s.canvases);
  const [creating, setCreating] = useState(false);
  const active = canvasIdFromPath(pathname, project.slug);
  return (
    <div className="mt-1" role="group" aria-label={`${project.name} canvases`}>
      <div className="group/cv flex items-center pr-1 pl-8">
        <span className="text-muted-foreground pixel flex-1 py-1 text-[10px] tracking-widest uppercase">Canvas</span>
        <Button size="icon-xs" variant="ghost" aria-label={`New canvas in ${project.name}`} title="New canvas" className="md:opacity-0 group-hover/cv:opacity-100 focus-visible:opacity-100" onClick={() => setCreating(true)}>
          <PlusIcon />
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {canvases.map((c) => {
          const status = live.find((l) => l.projectId === project.id && l.boardId === c.id)?.status ?? "idle";
          return (
            <li key={c.id}>
              <Link
                href={canvasPath(project, c.id)}
                aria-current={active === c.id ? "page" : undefined}
                className={cn("hover:bg-sidebar-accent flex min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-8 transition-colors", active === c.id && WORLD_SELECTION)}
              >
                <ShapesIcon className="text-muted-foreground size-3.5 shrink-0" />
                <span className="truncate text-[13px]">{c.name}</span>
                {status !== "idle" && <span className={cn("ml-auto size-2 shrink-0 rounded-full", status === "running" ? "bg-sky-500" : "bg-amber-500")} role="img" aria-label={CANVAS_STATUS_LABEL[status]} title={CANVAS_STATUS_LABEL[status]} />}
              </Link>
            </li>
          );
        })}
      </ul>
      <NewCanvasDialog open={creating} onOpenChange={setCreating} project={project} />
    </div>
  );
}
