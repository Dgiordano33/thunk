import { deliveryNotifications } from "@/lib/notifications/delivery";
import "server-only";
import { advanceDeliveryHistory, readDeliveryHistory, writeDeliveryHistory, type DeliveryHistory, type DeliverySnapshot } from "./delivery-history";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listProjects } from "../supabase/repo/projects";
import { listAllWorkspaces } from "../supabase/repo/workspaces";
import { toCheck, type RollupEntry } from "./github";
import { runtimeSnapshot } from "./runtime";
import { httpUrl, type WorkspaceDelivery } from "./delivery-types";
import { anchorTarget } from "./repo-targets";
import { gitRepos } from "./repos";
import type { Project, PullRequestInfo, Workspace } from "./types";

const exec = promisify(execFile);
const run = async (cmd: string, args: string[], cwd: string) =>
  (await exec(cmd, args, { cwd, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();

// shortcut: inspect 100 checks and 20 deployments per head; report truncated checks until nested pagination is needed.
export const DELIVERY_QUERY = `query($owner:String!, $name:String!, $endCursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequests(first:50, after:$endCursor, states:OPEN, orderBy:{field:UPDATED_AT,direction:DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id number url state title isDraft headRefName baseRefName isCrossRepository reviewDecision mergeable mergeStateStatus
        reviews(last:20) { nodes { id state submittedAt } }
        reviewRequests(first:100) { nodes { requestedReviewer { ... on User { id } ... on Team { id } ... on Mannequin { id } } } }
        commits(last:1) { nodes { commit {
          oid
          statusCheckRollup { contexts(first:100) { totalCount nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          } } }
          deployments(last:20) { nodes { id environment latestStatus { state environmentUrl } } }
        } } }
      }
    }
  }
}`;

type RawPr = Omit<PullRequestInfo, "checks" | "reviewDecision"> & {
  id: string;
  reviews: { nodes: { id: string; state: string; submittedAt: string | null }[] };
  reviewRequests: { nodes: { requestedReviewer: { id: string } | null }[] };
  headRefName: string; baseRefName: string; isCrossRepository: boolean;
  reviewDecision: PullRequestInfo["reviewDecision"] | "";
  commits: { nodes: { commit: {
    oid: string;
    statusCheckRollup: { contexts: { totalCount: number; nodes: RollupEntry[] } } | null;
    deployments: { nodes: { id: string; environment: string; latestStatus: { state: string; environmentUrl: string | null } | null }[] };
  } }[] };
};
type BranchDelivery = { snapshot: DeliverySnapshot; branch: string; base: string; pr: PullRequestInfo; previewUrl: string | null; repoId?: string };

export function parseDeliveries(pages: { errors?: { message: string }[]; data?: { repository: { pullRequests: { nodes: RawPr[] } } | null } }[]): BranchDelivery[] {
  return pages.flatMap((page) => {
    if (page.errors?.length) throw new Error(page.errors.map((e) => e.message).join("; "));
    if (!page.data?.repository) throw new Error("GitHub repository unavailable");
    return page.data.repository.pullRequests.nodes.filter((raw) => !raw.isCrossRepository).map((raw) => {
      const { headRefName, baseRefName, commits, reviewDecision } = raw;
      const pr = { number: raw.number, url: raw.url, state: raw.state, title: raw.title, isDraft: raw.isDraft, mergeable: raw.mergeable, mergeStateStatus: raw.mergeStateStatus };
      const commit = commits.nodes[0]?.commit;
      const contexts = commit?.statusCheckRollup?.contexts;
      const checks = (contexts?.nodes ?? []).map(toCheck).map((check) => ({ ...check, url: httpUrl(check.url) }));
      if (contexts && contexts.totalCount > contexts.nodes.length)
        checks.push({ name: "Additional checks — open GitHub to see all", state: "pending", url: pr.url });
      const previewUrl = [...(commit?.deployments.nodes ?? [])].reverse()
        .filter((d) => d.latestStatus?.state === "SUCCESS")
        .map((d) => httpUrl(d.latestStatus?.environmentUrl)).find(Boolean) ?? null;
      const snapshot: DeliverySnapshot = {
        id: raw.id, branch: headRefName, pr: { number: pr.number, url: pr.url, title: pr.title, head: commit?.oid ?? "" },
        state: pr.state, checks,
        reviews: raw.reviews.nodes.filter((r) => r.submittedAt && r.state !== "PENDING").map((r) => r.id),
        requests: raw.reviewRequests.nodes.flatMap((r) => r.requestedReviewer ? [r.requestedReviewer.id] : []),
        deployments: (commit?.deployments.nodes ?? []).map((d) => ({ id: d.id, state: d.latestStatus?.state ?? "PENDING", url: httpUrl(d.latestStatus?.environmentUrl) })),
      };
      return { snapshot, branch: headRefName, base: baseRefName, pr: { ...pr, reviewDecision: reviewDecision || null, checks }, previewUrl };
    });
  });
}

type CachedProject = { history?: DeliveryHistory; branches: BranchDelivery[]; nextPoll: number; updatedAt: string | null; error: string | null };
type State = { viewedUntil?: number; backgroundAt?: number; projects: Map<string, CachedProject>; deliveries: WorkspaceDelivery[]; timer: ReturnType<typeof setInterval> | null; ticking: boolean; tick: () => Promise<void> };
const g = globalThis as typeof globalThis & { __thunkDelivery?: State };
const state = (g.__thunkDelivery ??= { projects: new Map(), deliveries: [], timer: null, ticking: false, tick: async () => {} } as State);

async function projectDelivery(project: Project) {
  let cached = state.projects.get(project.id);
  if (cached && Date.now() < cached.nextPoll) return cached;
  cached ??= { branches: [], nextPoll: 0, updatedAt: null, error: null };
  const startedAt = Date.now();
  try {
    // All or nothing: advancing history from a partial list would read the unpolled repos' PRs as gone.
    const branches: BranchDelivery[] = [];
    const tracked = gitRepos(project).filter((r) => r.remote);
    for (const repo of tracked) {
      const pages = JSON.parse(await run("gh", ["api", "graphql", "--paginate", "--slurp", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${DELIVERY_QUERY}`], repo.path));
      branches.push(...parseDeliveries(pages).map((b) => ({ ...b, repoId: repo.id })));
    }
    if (tracked.length) {
      const previous = cached.history ?? await readDeliveryHistory(project.dataKey);
      const snapshots = branches.map((b) => b.snapshot);
      const missing = previous.snapshots.filter((s) => !snapshots.some((now) => now.id === s.id));
      // Disappearance alone can mean closed, deleted, or temporarily inaccessible, not merged.
      for (let offset = 0; offset < missing.length; offset += 50) {
        const batch = missing.slice(offset, offset + 50);
        const query = "query($ids:[ID!]!) { nodes(ids:$ids) { ... on PullRequest { id state } } }";
        const args = ["api", "graphql", "-f", `query=${query}`, ...batch.flatMap((s) => ["-f", `ids[]=${s.id}`])];
        const result = JSON.parse(await run("gh", args, tracked[0].path)) as { errors?: unknown[]; data?: { nodes: ({ id: string; state: DeliverySnapshot["state"] } | null)[] } };
        if (result.errors?.length || !result.data) throw new Error("Could not confirm missing PR states");
        for (const old of batch) {
          const confirmed = result.data.nodes.find((n) => n?.id === old.id);
          snapshots.push({ ...old, state: confirmed?.state ?? "CLOSED" });
        }
      }
      const history = advanceDeliveryHistory(previous, snapshots);
      if (JSON.stringify(history) !== JSON.stringify(previous)) await writeDeliveryHistory(project.dataKey, history);
      // Persist even an empty first baseline so its epoch survives restart.
      else if (!cached.history) await writeDeliveryHistory(project.dataKey, history);
      await deliveryNotifications(project.id, previous, history, snapshots).catch((err) => console.error("[thunk] delivery notification failed", err));
      cached.history = history;
    }
    cached.branches = branches;
    cached.updatedAt = new Date().toISOString();
    cached.error = null;
  } catch (err) {
    const message = String((err as { stderr?: string }).stderr || err);
    cached.error = /ENOENT/.test(message) ? "GitHub CLI (gh) is not installed" : /auth login|not logged/i.test(message) ? "Run gh auth login to see delivery status" : "GitHub delivery refresh failed; showing last known status";
  }
  cached.nextPoll = startedAt + (!cached.error && cached.branches.some((b) => b.pr.checks.some((c) => c.state === "pending")) ? 10_000 : 60_000);
  state.projects.set(project.id, cached);
  return cached;
}

async function workspaceDelivery(project: Project, ws: Workspace, cached: CachedProject): Promise<WorkspaceDelivery> {
  const target = anchorTarget({ project, workspace: ws });
  const base = target?.baseRef?.replace(/^origin\//, "") || target?.defaultBranch || "main";
  const [runtime, local] = await Promise.all([
    runtimeSnapshot({ project, workspace: ws }, false),
    target ? run("git", ["status", "--porcelain=v2", "--branch"], target.cwd) : Promise.resolve(null),
  ]);
  const branch = local?.match(/^# branch.head (.+)$/m)?.[1] ?? null;
  const actualBranch = branch === "(detached)" ? null : branch;
  const match = cached.branches.find((b) => b.branch === actualBranch && b.repoId === target?.id);
  const counts = target ? await run("git", ["rev-list", "--left-right", "--count", `${target.baseRef || `origin/${base}`}...HEAD`], target.cwd).catch(() => null) : null;
  const [behind, ahead] = counts?.split(/\s+/).map(Number) ?? [null, null];
  const reason = cached.error || (!target ? "No repositories" : !target.remote ? "No origin remote" : !actualBranch ? "Not on a branch" : actualBranch === base || actualBranch === target.defaultBranch ? "Start a workspace with its own branch" : null);
  return {
    activity: (cached.history?.events ?? []).filter((e) => e.branch === actualBranch).slice(-10).reverse(),
    workspaceId: ws.id, projectId: project.id,
    status: { branch: actualBranch, base: match?.base ?? base, pr: match?.pr ?? null, canCreate: !reason && !match, reason },
    git: local === null ? null : { ahead, behind, dirty: local.split("\n").some((line) => line && !line.startsWith("#")) },
    running: runtime.processes.some((p) => p.kind === "run" && p.running),
    localPreviewUrl: runtime.previewUrl, deployedPreviewUrl: match?.previewUrl ?? null,
    updatedAt: cached.updatedAt, error: cached.error || runtime.setupError,
  };
}

async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const viewed = Date.now() < (state.viewedUntil ?? 0);
    if (!viewed && Date.now() < (state.backgroundAt ?? 0)) return;
    state.backgroundAt = Date.now() + 30_000;
    const [projects, workspaces] = await Promise.all([listProjects(), listAllWorkspaces()]);
    const deliveries: WorkspaceDelivery[] = [];
    for (const project of projects) {
      const active = workspaces.filter((w) => w.projectId === project.id && w.status === "active");
      if (!active.length) continue;
      const cached = await projectDelivery(project);
      for (const ws of active) {
        try { deliveries.push(await workspaceDelivery(project, ws, cached)); }
        catch {
          const previous = state.deliveries.find((d) => d.workspaceId === ws.id);
          deliveries.push({
            activity: previous?.activity ?? [],
            workspaceId: ws.id, projectId: project.id,
            status: previous?.status ?? { branch: ws.branch, base: "main", pr: null, canCreate: false, reason: "Workspace unavailable" },
            git: null, running: false, localPreviewUrl: null, deployedPreviewUrl: previous?.deployedPreviewUrl ?? null,
            updatedAt: previous?.updatedAt ?? null, error: "Workspace delivery unavailable; check its folder and configuration",
          });
        }
      }
    }
    state.deliveries = deliveries;
    for (const id of state.projects.keys()) if (!projects.some((p) => p.id === id)) state.projects.delete(id);
  } catch (err) {
    console.error("[thunk] delivery poll failed", err);
    state.deliveries = state.deliveries.map((d) => ({ ...d, error: "Delivery refresh failed; showing last known status" }));
  }
  finally { state.ticking = false; }
}

export function ensureDeliveryPolling() {
  state.tick = tick;
  if (state.timer) return;
  state.timer = setInterval(() => void state.tick(), 10_000);
  state.timer.unref?.();
  void state.tick();
}

export function workspaceDeliveries(viewed = false) {
  if (viewed) {
    const expired = Date.now() >= (state.viewedUntil ?? 0);
    state.viewedUntil = Date.now() + 15_000;
    if (expired) { ensureDeliveryPolling(); void state.tick(); }
  }
  return state.deliveries;
}

export function deliveryHistories() {
  return [...state.projects].flatMap(([projectId, cached]) => cached.history && !cached.error ? [{ projectId, history: cached.history }] : []);
}
