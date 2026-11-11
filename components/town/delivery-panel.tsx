"use client";

import { ExternalLinkIcon, FolderIcon, GitBranchIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { DELIVERY_EVENT_LABELS } from "@/lib/projects/delivery-types";
import { Button } from "@/components/ui/button";
import { PrButton } from "@/components/workspace/pr-button";
import { api } from "@/lib/client/api";
import type { RuntimeSnapshot } from "@/lib/projects/runtime-types";
import { useAmbient } from "@/lib/store/ambient-store";

/** One checkout the workspace works in: a git repo (worktree or main checkout), a shared folder, or its scratch folder. */
export type RepoRow = { id: string | null; name: string; cwd: string; kind: "worktree" | "checkout" | "folder" | "scratch"; branch: string | null };

const KIND_LABEL: Record<RepoRow["kind"], string> = { worktree: "Worktree", checkout: "Your checkout", folder: "Shared folder", scratch: "Scratch folder" };
const KIND_TITLE: Record<RepoRow["kind"], string> = {
  worktree: "A separate copy of the repo on this workspace's own branch",
  checkout: "The repo's main checkout, on whatever branch it has checked out",
  folder: "A plain folder, shared with every workspace that uses it",
  scratch: "A folder Thunk made for this workspace",
};

/** Each repo the workspace covers, with its own branch, local changes and pull request. */
export function WorkspaceRepos({ workspaceId, rows }: { workspaceId: string; rows: RepoRow[] }) {
  const delivery = useAmbient((s) => s.deliveries.find((d) => d.workspaceId === workspaceId));
  const multiGit = rows.filter((r) => r.kind === "worktree" || r.kind === "checkout").length > 1;
  return <div className="space-y-3 text-xs">
    <ul className="space-y-2">
      {rows.map((row) => {
        const repo = delivery?.repos?.find((r) => r.repoId === row.id);
        const status = repo?.status;
        const branch = status ? status.branch : row.branch;
        const isGit = row.kind === "worktree" || row.kind === "checkout";
        // On the base branch there is nothing to say: the note under the list covers it.
        const reason = status && !status.pr && !status.canCreate && status.branch !== status.base ? status.reason : null;
        return <li key={row.id ?? row.cwd} className="border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{row.name}</span>
            <span className="text-muted-foreground shrink-0" title={KIND_TITLE[row.kind]}>{KIND_LABEL[row.kind]}</span>
            {status && (status.pr || status.canCreate) && <span className="ml-auto shrink-0">
              <PrButton unlabeled workspaceId={workspaceId} deliveryStatus={status} repo={multiGit && row.id ? { id: row.id, name: row.name, cwd: row.cwd } : undefined} />
            </span>}
          </div>
          {isGit && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-center gap-1 font-mono"><GitBranchIcon className="size-3 shrink-0" /><span className="truncate">{branch || (status ? "No branch" : "…")}</span></span>
            {repo && <span className="text-muted-foreground font-mono tabular-nums" title={`${repo.git.ahead ?? "?"} ahead of ${status!.base}, ${repo.git.behind ?? "?"} behind`}>↑{repo.git.ahead ?? "?"} ↓{repo.git.behind ?? "?"}</span>}
            {repo?.git.dirty && <span className="text-amber-600 dark:text-amber-400">Uncommitted changes</span>}
            {repo?.deployedPreviewUrl && <a href={repo.deployedPreviewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline"><ExternalLinkIcon className="size-3" />Deployed preview</a>}
          </div>}
          {reason && <p role="status" className="text-muted-foreground mt-1">{reason}</p>}
          <button
            type="button"
            title="Reveal in Finder"
            className="text-muted-foreground hover:text-foreground mt-1.5 flex max-w-full items-center gap-1 font-mono"
            onClick={() => void api.revealWorkspace(workspaceId, row.id ?? undefined).catch((err: Error) => window.alert(err.message))}
          >
            <FolderIcon className="size-3 shrink-0" /><span className="truncate">{row.cwd.replace(/^\/(Users|home)\/[^/]+/, "~")}</span>
          </button>
        </li>;
      })}
    </ul>
    {delivery?.error && <p role="status" className="text-muted-foreground">{delivery.error}</p>}
    {Boolean(delivery?.activity?.length) && <div className="border-t pt-3">
      <h4 className="text-muted-foreground mb-2">Recent activity</h4>
      <ol className="space-y-1.5">
        {delivery!.activity.map((event) => <li key={event.id} className="flex items-start justify-between gap-2">
          <a href={event.previewUrl || event.pr.url} target="_blank" rel="noreferrer" className="hover:underline">{DELIVERY_EVENT_LABELS[event.type]} · #{event.pr.number}</a>
          <time dateTime={event.at} title={new Date(event.at).toLocaleString()} className="text-muted-foreground shrink-0">{relativeTime(event.at)}</time>
        </li>)}
      </ol>
    </div>}
  </div>;
}

/** Start and stop the workspace's run script, and open what it serves. */
export function DevServer({ workspaceId }: { workspaceId: string }) {
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = () => api.workspaceRuntime(workspaceId).then((data) => {
      if (!stopped) { setRuntime(data); setError(null); }
    }).catch((err: Error) => { if (!stopped) setError(err.message); });
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => { stopped = true; clearInterval(timer); };
  }, [workspaceId]);
  const running = runtime?.processes.some((p) => p.kind === "run" && p.running);
  const control = async () => {
    setPending(true);
    setError(null);
    try {
      await api.workspaceProcess(workspaceId, running ? { action: "stop", kind: "run" } : { action: "run" });
      setRuntime(await api.workspaceRuntime(workspaceId));
    } catch (err) { setError((err as Error).message); }
    finally { setPending(false); }
  };
  const hint = (runtime && !runtime.scripts.run ? "Add a run script in thunk.json to preview this workspace locally." : null)
    || (running && !runtime?.previewUrl ? "Dev server running; waiting for its preview port." : null);
  return <div className="space-y-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={!runtime || pending || runtime.busy || runtime.archived || (!running && !runtime.scripts.run)} onClick={() => void control()}>
        {running ? <SquareIcon /> : <PlayIcon />}
        {pending ? "Working…" : running ? "Stop dev server" : "Start dev server"}
      </Button>
      {runtime?.previewUrl && <Button size="sm" variant="outline" asChild><a href={runtime.previewUrl} target="_blank" rel="noreferrer"><ExternalLinkIcon />Local preview</a></Button>}
    </div>
    {hint && <p role="status" className="text-muted-foreground">{hint}</p>}
    {(error || runtime?.setupError) && <p role="alert" className="text-destructive">{error || runtime?.setupError}</p>}
  </div>;
}
