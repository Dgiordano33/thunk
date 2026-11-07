"use client";

import { GitBranchIcon, Loader2Icon, PlusIcon, ZapIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionMeta } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import type { Project, Workspace } from "@/lib/projects/types";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

export function Sidebar({
  sessions,
  project,
  workspace,
}: {
  sessions: SessionMeta[];
  project: Project | null;
  workspace: Workspace | null;
}) {
  const router = useRouter();
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const [creating, setCreating] = useState(false);

  // New session in the same workspace with the same model and mode.
  const newSession = async () => {
    if (!meta) return;
    setCreating(true);
    try {
      const { id } = await api.createSession({
        workspaceId: meta.workspaceId,
        model: meta.model,
        permissionMode: meta.permissionMode,
      });
      router.push(`/s/${id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <Link href="/" className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <ZapIcon className="size-4" />
          Thunk
        </Link>
        <Button size="icon-sm" variant="ghost" aria-label="New session" onClick={newSession} disabled={creating}>
          {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
        </Button>
      </div>

      <div className="flex flex-col gap-0.5 px-3 pb-2">
        {project ? (
          <Link href={`/p/${project.id}`} className="truncate text-xs font-medium hover:underline" title={project.root}>
            {project.name}
          </Link>
        ) : (
          <p className="text-muted-foreground truncate font-mono text-[11px]">{meta?.cwd}</p>
        )}
        {workspace && (
          <Link
            href={`/w/${workspace.id}`}
            className="text-muted-foreground flex items-center gap-1 truncate text-[11px] hover:underline"
            title={workspace.cwd}
          >
            {workspace.worktreePath && <GitBranchIcon className="size-3 shrink-0" />}
            <span className="truncate">{workspace.worktreePath ? workspace.branch : workspace.name}</span>
          </Link>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 px-2 pb-3">
          {sessions.map((s) => {
            const current = s.id === meta?.id;
            const live = current ? Boolean(meta?.live) : s.live;
            const busy = current && (status === "running" || status === "awaiting");
            return (
              <li key={s.id}>
                <Link
                  href={`/s/${s.id}`}
                  className={cn(
                    "hover:bg-sidebar-accent block rounded-md px-2 py-1.5 transition-colors",
                    current && "bg-sidebar-accent",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        busy ? "animate-pulse bg-amber-500" : live ? "bg-emerald-500" : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="truncate text-[13px]">{(current ? meta?.title : s.title) || "Untitled"}</span>
                  </div>
                  <p className="text-muted-foreground pl-3.5 text-[11px]">{relativeTime(s.createdAt)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
