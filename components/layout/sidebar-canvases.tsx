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
import { FOCUS, ROW } from "@/components/layout/sidebar-row";

/** The board a pathname shows, when it is one of this project's canvases. */
export function canvasIdFromPath(pathname: string, slug: string) {
  const [, project, section, board] = pathname.split("/");
  return project === slug && section === "canvas" ? board ? decodeURIComponent(board) : "main" : null;
}

/** A project's canvases in the sidebar, each with its agent's status. They have no heading:
 * the shapes icon names the kind, and each row reveals a new-canvas button the way workspace rows reveal their menu. */
export function SidebarCanvases({ project, canvases, pathname }: { project: { id: string; slug: string; name: string }; canvases: CanvasSession[]; pathname: string }) {
  const live = useAmbient((s) => s.canvases);
  const [creating, setCreating] = useState(false);
  const active = canvasIdFromPath(pathname, project.slug);
  return (
    <div className="mt-0.5" role="group" aria-label={`${project.name} canvases`}>
      <ul className="flex flex-col gap-0.5">
        {canvases.map((c) => {
          const status = live.find((l) => l.projectId === project.id && l.boardId === c.id)?.status ?? "idle";
          return (
            <li key={c.id} className={cn(ROW, active === c.id && WORLD_SELECTION)}>
              <Link
                href={canvasPath(project, c.id)}
                aria-current={active === c.id ? "page" : undefined}
                className={cn("flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-8", FOCUS)}
              >
                <ShapesIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate text-[13px]">{c.name}</span>
                {status !== "idle" && <span className={cn("ml-auto size-2 shrink-0 rounded-full", status === "running" ? "bg-[var(--status-running)]" : "bg-[var(--status-attention-ink)]")} role="img" aria-label={CANVAS_STATUS_LABEL[status]} title={CANVAS_STATUS_LABEL[status]} />}
              </Link>
              <span className="sidebar-row-actions flex shrink-0 items-center">
                <Button size="icon-xs" variant="ghost" aria-label={`New canvas in ${project.name}`} title="New canvas" onClick={() => setCreating(true)}>
                  <PlusIcon />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      <NewCanvasDialog open={creating} onOpenChange={setCreating} project={project} />
    </div>
  );
}
