"use client";

import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleMinusIcon,
  CircleXIcon,
  ExternalLinkIcon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  GitPullRequestIcon,
  Loader2Icon,
  MessageSquareReplyIcon,
  WrenchIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/client/api";
import type { CheckState, PullRequestInfo, WorkspacePrStatus } from "@/lib/projects/types";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;
/** While a PR is being created, checks are running, or mergeability is being computed. */
const FAST_POLL_MS = 8_000;

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

function fixChecksPrompt(pr: PullRequestInfo) {
  const failing = pr.checks.filter((c) => c.state === "fail");
  return [
    `CI is failing on PR #${pr.number} (${pr.url}). Fix it.`,
    "",
    "Failing checks:",
    ...failing.map((c) => `- ${c.name}${c.url ? ` (${c.url})` : ""}`),
    "",
    `1. Find out why: \`gh pr checks ${pr.number}\`, and for GitHub Actions \`gh run view <run-id> --log-failed\`. For external checks (e.g. Vercel), read the linked page or reproduce the build/test locally.`,
    "2. Fix the root cause in the code. Don't skip, disable or weaken tests or checks to make them pass.",
    "3. Run the relevant build/lint/tests locally to confirm.",
    "4. Commit with a clear message and push to the PR branch.",
    "",
    "Summarize what was wrong and what you changed.",
  ].join("\n");
}

function resolveConflictsPrompt(pr: PullRequestInfo, base: string) {
  return [
    `PR #${pr.number} (${pr.url}) has merge conflicts with \`${base}\`. Resolve them.`,
    "",
    `1. \`git fetch origin\` and merge \`origin/${base}\` into this branch (merge, not rebase, so no force-push is needed).`,
    "2. Resolve every conflict by keeping the intent of both sides; ask me if a conflict needs a product decision.",
    "3. Build/lint/test to make sure the merged result works.",
    "4. Commit the merge and push.",
    "",
    "Summarize which files conflicted and how you resolved each.",
  ].join("\n");
}

function addressReviewPrompt(pr: PullRequestInfo) {
  return [
    `Reviewers requested changes on PR #${pr.number} (${pr.url}). Address them.`,
    "",
    `1. Read the review and inline comments: \`gh pr view ${pr.number} --comments\` and \`gh api repos/{owner}/{repo}/pulls/${pr.number}/comments\`.`,
    "2. Make the requested changes. If you disagree with a comment, don't change it; tell me why instead.",
    "3. Build/lint/test, commit and push.",
    "",
    "List each comment and what you did about it.",
  ].join("\n");
}

export type PrAction = "create" | "fix-checks" | "resolve-conflicts" | "address-review";

const ACTION_TITLE: Record<PrAction, string> = {
  create: "Create PR",
  "fix-checks": "Fix CI",
  "resolve-conflicts": "Resolve conflicts",
  "address-review": "Address review",
};

/** After handing the agent a PR job, poll fast for a while so the button reflects its pushes. */
const FAST_AFTER_REQUEST_MS = 5 * 60_000;

/** Top-right PR action: "Create PR" hands the job to the agent; once a PR exists it links to it. */
export function PrButton({ workspaceId, deliveryStatus, inline = false }: { workspaceId: string; deliveryStatus?: WorkspacePrStatus | null; inline?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loadedStatus, setStatus] = useState<WorkspacePrStatus | null>(null);
  const [requested, setRequested] = useState<{ action: PrAction; at: number } | null>(null);
  const [pending, setPending] = useState<PrAction | null>(null);

  const status = deliveryStatus === undefined ? loadedStatus : deliveryStatus;
  const pr = status?.pr;
  const creating = requested?.action === "create" && pr?.state !== "OPEN";
  const fast =
    creating ||
    (requested !== null && Date.now() - requested.at < FAST_AFTER_REQUEST_MS) ||
    (pr?.state === "OPEN" && (pr.checks.some((c) => c.state === "pending") || pr.mergeable === "UNKNOWN"));

  const load = useCallback(
    () =>
      api
        .workspacePr(workspaceId)
        .then((r) => setStatus(r.status))
        .catch(() => setStatus(null)),
    [workspaceId],
  );
  useEffect(() => {
    if (deliveryStatus !== undefined) return;
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), fast ? FAST_POLL_MS : POLL_MS);
    return () => clearInterval(t);
  }, [load, fast, deliveryStatus]);
  /** Hand a PR job to the agent: the open session tab if it's live, otherwise a dedicated new session. */
  const ask = async (action: PrAction, prompt: string) => {
    setPending(action);
    try {
      const sid = pathname.match(/\/s\/([^/]+)$/)?.[1];
      const s = useSession.getState();
      if (sid && s.sessionId === sid && s.meta?.live) {
        await api.send(sid, prompt);
      } else {
        const { id } = await api.createSession({ workspaceId, prompt, title: ACTION_TITLE[action] });
        router.push(`/w/${workspaceId}/s/${id}`);
        router.refresh();
      }
      setRequested({ action, at: Date.now() });
    } catch (err) {
      window.alert(`Couldn't hand off "${ACTION_TITLE[action]}": ${(err as Error).message}`);
    } finally {
      setPending(null);
    }
  };

  if (!status) return null;

  if (pr && pr.state === "OPEN")
    return (
      <OpenPr
        inline={inline}
        pr={pr}
        base={status.base}
        pending={pending}
        requested={requested && Date.now() - requested.at < FAST_AFTER_REQUEST_MS ? requested.action : null}
        onAsk={(action) =>
          void ask(
            action,
            action === "fix-checks"
              ? fixChecksPrompt(pr)
              : action === "resolve-conflicts"
                ? resolveConflictsPrompt(pr, status.base)
                : addressReviewPrompt(pr),
          )
        }
      />
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
      <Button
        size="sm"
        className="h-7 gap-1.5"
        onClick={() => void ask("create", prPrompt(status))}
        disabled={!status.canCreate || pending !== null || creating}
      >
        {pending || creating ? <Loader2Icon className="animate-spin" /> : <GitPullRequestArrowIcon />}
        {creating ? "Creating PR…" : "Create PR"}
      </Button>
    </span>
  );
}

const CHECK_ICON: Record<CheckState, { icon: typeof CircleCheckIcon; className: string; label: string }> = {
  pass: { icon: CircleCheckIcon, className: "text-emerald-600 dark:text-emerald-400", label: "Passed" },
  fail: { icon: CircleXIcon, className: "text-red-600 dark:text-red-400", label: "Failed" },
  pending: { icon: CircleDashedIcon, className: "animate-spin text-amber-500 [animation-duration:3s]", label: "Running" },
  skipped: { icon: CircleMinusIcon, className: "text-muted-foreground", label: "Skipped" },
};

/** Worst state wins: one failure fails the PR, otherwise anything still running keeps it pending. */
function overall(pr: PullRequestInfo): CheckState | null {
  if (!pr.checks.length) return null;
  if (pr.checks.some((c) => c.state === "fail")) return "fail";
  if (pr.checks.some((c) => c.state === "pending")) return "pending";
  return "pass";
}

function mergeLine(pr: PullRequestInfo, base: string): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") return { text: `Merge conflicts with ${base}`, tone: "bad" };
  if (pr.mergeable === "UNKNOWN") return { text: "Checking for conflicts…", tone: "muted" };
  if (pr.mergeStateStatus === "BEHIND") return { text: `No conflicts · behind ${base}`, tone: "warn" };
  return { text: "No merge conflicts", tone: "ok" };
}

const REVIEW_LINE: Record<string, { text: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  APPROVED: { text: "Approved", tone: "ok" },
  CHANGES_REQUESTED: { text: "Changes requested", tone: "bad" },
  REVIEW_REQUIRED: { text: "Review required", tone: "warn" },
};

const TONE = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};

function OpenPr({
  inline,
  pr,
  base,
  pending,
  requested,
  onAsk,
}: {
  inline?: boolean;
  pr: PullRequestInfo;
  base: string;
  pending: PrAction | null;
  requested: PrAction | null;
  onAsk: (action: Exclude<PrAction, "create">) => void;
}) {
  const state = overall(pr);
  const conflicts = pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
  const StateIcon = state ? CHECK_ICON[state].icon : null;

  if (inline) return <PrSummary pr={pr} base={base} pending={pending} requested={requested} onAsk={onAsk} />;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1.5" title={pr.title}>
          <GitPullRequestIcon className={cn(pr.isDraft ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400")} />
          {pr.isDraft ? "Draft" : "PR"} #{pr.number}
          {conflicts ? (
            <CircleDotIcon className={TONE.bad} aria-label="Merge conflicts" />
          ) : (
            StateIcon && <StateIcon className={CHECK_ICON[state!].className} aria-label={`Checks ${CHECK_ICON[state!].label}`} />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PrSummary pr={pr} base={base} pending={pending} requested={requested} onAsk={onAsk} />
      </PopoverContent>
    </Popover>
  );
}

export function PrSummary({ pr, base, pending, requested, onAsk }: {
  pr: PullRequestInfo;
  base: string;
  pending: PrAction | null;
  requested: PrAction | null;
  onAsk: (action: Exclude<PrAction, "create">) => void;
}) {
  const state = overall(pr);
  const conflicts = pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
  const merge = mergeLine(pr, base);
  const review = pr.reviewDecision ? REVIEW_LINE[pr.reviewDecision] : { text: "No review required", tone: "muted" as const };
  const counts = (s: CheckState) => pr.checks.filter((c) => c.state === s).length;
  return <>
        <div className="border-b px-4 py-3">
          <a href={pr.url} target="_blank" rel="noreferrer" className="group flex items-start gap-2">
            <span className="min-w-0 flex-1 text-sm leading-snug font-medium group-hover:underline">
              {pr.title} <span className="text-muted-foreground font-normal">#{pr.number}</span>
            </span>
            <ExternalLinkIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          </a>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Merge</dt>
            <dd className={TONE[merge.tone]}>{merge.text}</dd>
            <dt className="text-muted-foreground">Review</dt>
            <dd className={TONE[review.tone]}>{review.text}</dd>
            <dt className="text-muted-foreground">Checks</dt>
            <dd className={state ? TONE[state === "pass" ? "ok" : state === "fail" ? "bad" : "warn"] : TONE.muted}>
              {!state
                ? "None reported"
                : [
                    counts("fail") && `${counts("fail")} failing`,
                    counts("pending") && `${counts("pending")} running`,
                    counts("pass") && `${counts("pass")} passed`,
                    counts("skipped") && `${counts("skipped")} skipped`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </dd>
          </dl>
        </div>
        <FixActions pr={pr} conflicts={conflicts} pending={pending} requested={requested} onAsk={onAsk} />
        {pr.checks.length > 0 && (
          <ul className="max-h-72 overflow-y-auto py-1">
            {pr.checks.map((c) => {
              const { icon: Icon, className, label } = CHECK_ICON[c.state];
              const row = (
                <>
                  <Icon className={cn("size-3.5 shrink-0", className)} aria-label={label} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.url && <ExternalLinkIcon className="text-muted-foreground size-3 shrink-0" />}
                </>
              );
              return (
                <li key={c.name}>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="hover:bg-muted flex items-center gap-2 px-4 py-1.5 text-xs">
                      {row}
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-1.5 text-xs">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
  </>;
}

function FixActions({
  pr,
  conflicts,
  pending,
  requested,
  onAsk,
}: {
  pr: PullRequestInfo;
  conflicts: boolean;
  pending: PrAction | null;
  requested: PrAction | null;
  onAsk: (action: Exclude<PrAction, "create">) => void;
}) {
  const actions: { action: Exclude<PrAction, "create">; label: string; icon: typeof WrenchIcon }[] = [];
  if (pr.checks.some((c) => c.state === "fail")) actions.push({ action: "fix-checks", label: "Fix failing checks", icon: WrenchIcon });
  if (conflicts) actions.push({ action: "resolve-conflicts", label: "Resolve conflicts", icon: GitMergeIcon });
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    actions.push({ action: "address-review", label: "Address review", icon: MessageSquareReplyIcon });
  if (!actions.length) return null;

  return (
    <div className="flex flex-wrap gap-2 border-b px-4 py-3">
      {actions.map(({ action, label, icon: Icon }) => (
        <Button
          key={action}
          size="sm"
          variant={action === actions[0].action ? "default" : "outline"}
          className="h-7 gap-1.5"
          disabled={pending !== null || requested === action}
          title="Hand this to Claude in the open session (or a new one)"
          onClick={() => onAsk(action)}
        >
          {pending === action ? <Loader2Icon className="animate-spin" /> : <Icon />}
          {requested === action ? "Sent to Claude" : `${label} with Claude`}
        </Button>
      ))}
    </div>
  );
}
