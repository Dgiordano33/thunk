"use client";

import { GitMergeIcon, GitPullRequestArrowIcon, GitPullRequestIcon, Loader2Icon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { WorkspacePrStatus } from "@/lib/projects/types";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;
/** After asking for a PR, check more often so the button flips to "PR #n" soon after it exists. */
const FAST_POLL_MS = 5_000;

function prPrompt(status: WorkspacePrStatus) {
  return [
    `Create a pull request for this workspace's branch \`${status.branch}\` into \`${status.base}\`.`,
    "",
    `1. Review what changed vs \`origin/${status.base}\` (git status, git diff, git log).`,
    "2. Commit any uncommitted work with clear, conventional commit messages. Don't commit secrets or local artifacts.",
    `3. Push the branch to origin (set upstream if needed).`,
    `4. Open the PR with \`gh pr create --base ${status.base}\`: a concise title and a description summarizing the changes and how to test them.`,
    "",
    "Reply with the PR URL when it's open.",
  ].join("\n");
}

/** Top-right PR action: "Create PR" hands the job to the agent; once a PR exists it links to it. */
export function PrButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<WorkspacePrStatus | null>(null);
  const [requested, setRequested] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(
    () =>
      api
        .workspacePr(workspaceId)
        .then((r) => setStatus(r.status))
        .catch(() => setStatus(null)),
    [workspaceId],
  );
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), requested ? FAST_POLL_MS : POLL_MS);
    return () => clearInterval(t);
  }, [load, requested]);
  // Stop fast-polling once the PR shows up.
  useEffect(() => {
    if (status?.pr?.state === "OPEN") setRequested(false);
  }, [status?.pr?.state]);

  const create = async () => {
    if (!status) return;
    setPending(true);
    try {
      const prompt = prPrompt(status);
      // Prefer the open session tab; otherwise start a dedicated one.
      const sid = pathname.match(/\/s\/([^/]+)$/)?.[1];
      const s = useSession.getState();
      if (sid && s.sessionId === sid && s.meta?.live) {
        await api.send(sid, prompt);
      } else {
        const { id } = await api.createSession({ workspaceId, prompt, title: "Create PR" });
        router.push(`/w/${workspaceId}/s/${id}`);
        router.refresh();
      }
      setRequested(true);
    } catch (err) {
      window.alert(`Couldn't start the PR: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  if (!status) return null;
  const { pr } = status;

  if (pr && pr.state === "OPEN")
    return (
      <Button size="sm" variant="outline" className="h-7 gap-1.5" asChild>
        <a href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>
          <GitPullRequestIcon className={cn(pr.isDraft ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400")} />
          {pr.isDraft ? "Draft" : "PR"} #{pr.number}
        </a>
      </Button>
    );

  if (pr && pr.state === "MERGED")
    return (
      <Button size="sm" variant="outline" className="h-7 gap-1.5" asChild>
        <a href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>
          <GitMergeIcon className="text-violet-600 dark:text-violet-400" />
          Merged #{pr.number}
        </a>
      </Button>
    );

  // The wrapper carries the tooltip: disabled buttons don't receive pointer events.
  return (
    <span title={status.reason ?? `Ask Claude to commit, push and open a PR into ${status.base}`}>
      <Button size="sm" className="h-7 gap-1.5" onClick={create} disabled={!status.canCreate || pending || requested}>
        {pending || requested ? <Loader2Icon className="animate-spin" /> : <GitPullRequestArrowIcon />}
        {requested ? "Creating PR…" : "Create PR"}
      </Button>
    </span>
  );
}
