"use client";

import { GitBranchIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionMeta } from "@/lib/agent/types";
import type { Workspace } from "@/lib/projects/types";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";
import { PrButton } from "./pr-button";

export function WorkspaceTabs({
  workspace,
  sessions,
  branch,
  dirty,
}: {
  workspace: Workspace;
  sessions: SessionMeta[];
  branch: string | null;
  dirty: number;
}) {
  const pathname = usePathname();
  const base = `/w/${workspace.id}`;
  const onNew = pathname === `${base}/new`;
  // The open session's title and status stream in live; everything else comes from the server.
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const branched = workspace.repos.filter((r) => r.branch);

  return (
    <div className="flex h-11 shrink-0 items-stretch border-b">
      <nav className="flex min-w-0 flex-1 items-stretch overflow-x-auto" aria-label="Sessions">
        {sessions.map((s) => {
          const href = `${base}/s/${s.id}`;
          const active = pathname === href;
          const current = s.id === meta?.id;
          const live = current ? Boolean(meta?.live) : s.live;
          const busy = current && (status === "running" || status === "awaiting");
          return (
            <Link
              key={s.id}
              href={href}
              aria-current={active ? "page" : undefined}
              title={(current ? meta?.title : s.title) || "Untitled"}
              className={cn(
                "text-muted-foreground hover:text-foreground relative flex max-w-56 min-w-0 shrink-0 items-center gap-2 px-4 text-[13px] transition-colors",
                active &&
                  "text-foreground after:bg-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  busy ? "animate-pulse bg-amber-500" : live ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <span className="truncate">{(current ? meta?.title : s.title) || "Untitled"}</span>
            </Link>
          );
        })}
        <Link
          href={`${base}/new`}
          aria-label="New chat"
          aria-current={onNew ? "page" : undefined}
          className={cn(
            "text-muted-foreground hover:text-foreground relative flex shrink-0 items-center gap-1.5 px-3 text-[13px] transition-colors",
            onNew &&
              "text-foreground after:bg-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
          )}
        >
          <PlusIcon className="size-4" />
          {(onNew || sessions.length === 0) && <span>New chat</span>}
        </Link>
      </nav>

      <div className="text-muted-foreground flex shrink-0 items-center gap-2 border-l px-3 text-xs" title={workspace.cwd}>
        <GitBranchIcon className="size-3.5" />
        <span className="max-w-48 truncate font-mono">{branch ?? workspace.name}</span>
        {dirty > 0 && <span className="tabular-nums">{dirty} changed</span>}
        {/* Several branched repos each get their own PR; a single one needs no repo label. */}
        {branched.length > 1 ? branched.map((r) => (
          <PrButton key={r.repoId} workspaceId={workspace.id} repo={{ id: r.repoId, name: r.name, cwd: r.cwd }} />
        )) : workspace.repos.length > 0 && <PrButton workspaceId={workspace.id} />}
      </div>
    </div>
  );
}
