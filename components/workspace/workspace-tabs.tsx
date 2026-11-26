"use client";
import { relativeTime, sessionStatus, sessionDot } from "@/components/session/labels";
import { useIsDesktop } from "@/components/mobile/viewport";
import { MobileDrawer } from "@/components/mobile/drawer";

import { ChevronDownIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { SessionMeta } from "@/lib/agent/types";
import type { Workspace } from "@/lib/projects/types";
import { useSession } from "@/lib/store/session-store";
import { lineTabIndicator } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { OpenFileTabs } from "./open-file-tabs";
import { PrButton } from "./pr-button";

export function WorkspaceTabs({
  workspace,
  base,
  sessions,
}: {
  workspace: Workspace;
  base: string;
  sessions: SessionMeta[];
}) {
  const [loadedGit, setLoadedGit] = useState<{ id: string; branch: string | null; dirty: number } | null>(null);
  const gitStatus = loadedGit?.id === workspace.id ? loadedGit : { branch: workspace.branch, dirty: 0 };
  useEffect(() => {
    if (!workspace.repos.length) return;
    const controller = new AbortController();
    void fetch(`/api/workspaces/${workspace.id}/git/status`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Git status unavailable"); return response.json(); })
      .then(status => { if (!controller.signal.aborted) setLoadedGit({ ...status, id: workspace.id }); })
      .catch(() => {});
    return () => controller.abort();
  }, [workspace.id, workspace.repos.length]);
  const desktop = useIsDesktop();
  const pathname = usePathname();
  const onNew = pathname === `${base}/new`;
  // The open session's title and status stream in live; everything else comes from the server.
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const branched = workspace.repos.filter((r) => r.branch);

  if (!desktop) {
    const open = sessions.find((s) => pathname === `${base}/${s.id}`);
    const stateOf = (s: SessionMeta) => {
      const current = s.id === meta?.id;
      return { ...s, ...(current ? meta : {}), live: Boolean(current ? meta?.live : s.live), status: current ? status : s.status };
    };
    const title = open ? stateOf(open).title || "Untitled" : onNew ? "New chat" : "Sessions";
    return (
      <>
        <MobileDrawer
          title="Sessions"
          className="flex-1 px-1 text-left"
          trigger={
            <span className="flex items-center gap-2">
              {open && <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", sessionDot(stateOf(open)))} />}
              <span className="truncate font-medium">{title}</span>
              {open && <span className="sr-only">· {sessionStatus(stateOf(open))}</span>}
              <ChevronDownIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            </span>
          }
        >
          <nav className="flex flex-col gap-1 px-2 pb-4" aria-label="Sessions">
            <Link href={`${base}/new`} aria-current={onNew ? "page" : undefined} className="aria-[current=page]:bg-muted flex min-h-11 items-center gap-3 rounded-md px-3 font-medium"><PlusIcon className="size-4" /> New chat</Link>
            {sessions.map((s) => {
              const state = stateOf(s);
              return (
                <Link key={s.id} href={`${base}/${s.id}`} aria-current={s === open ? "page" : undefined} className="aria-[current=page]:bg-muted flex min-h-14 items-center gap-3 rounded-md px-3">
                  <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", sessionDot(state))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{state.title || "Untitled"}</span>
                    <span className="text-muted-foreground block truncate text-xs">{sessionStatus(state)} · {relativeTime(state.updatedAt ?? state.createdAt)}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </MobileDrawer>
        {workspace.repos.length > 0 && (
          <MobileDrawer title="Branch and PR" className="relative px-0" trigger={<><GitBranchIcon className="mx-auto size-5" /><GitDirtyIndicator status={gitStatus} /></>}>
            <p className="px-4 pb-4 font-mono text-sm break-words"><GitLabel status={gitStatus} name={workspace.name} /></p>
            <div className="flex flex-col items-start gap-2 px-4 pb-4">
              {branched.length > 1 ? branched.map(r => <PrButton key={r.repoId} workspaceId={workspace.id} repo={{ id: r.repoId, name: r.name, cwd: r.cwd }} />) : <PrButton workspaceId={workspace.id} />}
            </div>
          </MobileDrawer>
        )}
      </>
    );
  }

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b">
      <nav className="flex min-w-0 flex-1 items-stretch overflow-x-auto" aria-label="Sessions">
        {sessions.map((s) => {
          const href = `${base}/${s.id}`;
          const active = pathname === href;
          const current = s.id === meta?.id;
          const live = current ? Boolean(meta?.live) : s.live;
          const state = { ...s, ...(current ? meta : {}), live: Boolean(live), status: current ? status : s.status };
          return (
            <Link
              key={s.id}
              href={href}
              data-active={active}
              aria-current={active ? "page" : undefined}
              title={(current ? meta?.title : s.title) || "Untitled"}
              className={cn(
                "text-muted-foreground hover:text-foreground relative flex max-w-56 min-w-0 shrink-0 items-center gap-2 px-4 text-[13px] transition-colors",
                lineTabIndicator, "after:h-0.5 after:inset-x-0 after:bottom-0",
              )}
            >
              <span role="img" aria-label={sessionStatus(state)} title={sessionStatus(state)}
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  sessionDot(state),
                )}
              />
              <span className="truncate">{(current ? meta?.title : s.title) || "Untitled"}</span>
            </Link>
          );
        })}
        <Suspense>
          <OpenFileTabs workspaceId={workspace.id} base={base} />
        </Suspense>
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
        <GitLabel status={gitStatus} name={workspace.name} />
        {/* Several branched repos each get their own PR; a single one needs no repo label. */}
        {branched.length > 1 ? branched.map((r) => (
          <PrButton key={r.repoId} workspaceId={workspace.id} repo={{ id: r.repoId, name: r.name, cwd: r.cwd }} />
        )) : workspace.repos.length > 0 && <PrButton workspaceId={workspace.id} />}
      </div>
    </div>
  );
}

/** Git decoration loads after navigation, without holding the route response open. */
function GitLabel({ status, name }: { status: { branch: string | null; dirty: number }; name: string }) {
  const { branch, dirty } = status;
  return <><span className="max-w-48 truncate font-mono">{branch ?? name}</span>{dirty > 0 && <span className="ml-2 tabular-nums">{dirty} changed</span>}</>;
}

function GitDirtyIndicator({ status }: { status: { branch: string | null; dirty: number } }) {
  const { dirty } = status;
  return dirty > 0 ? <span aria-hidden="true" className="absolute top-2.5 right-2.5 size-1.5 rounded-full bg-[var(--status-attention)]" /> : null;
}
