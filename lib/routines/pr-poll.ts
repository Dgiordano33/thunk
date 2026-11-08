import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getProject } from "@/lib/supabase/repo/projects";
import { listEnabledRoutines, updateRoutine } from "@/lib/supabase/repo/routines";
import { fire } from "./runner";
import type { Routine } from "./types";

const exec = promisify(execFile);
const SEEN_CAP = 200;

type GhPr = { number: number; url: string; title: string; author: { login: string } | null; headRefName: string; createdAt: string };

async function openPrs(root: string): Promise<GhPr[]> {
  const { stdout } = await exec(
    "gh",
    ["pr", "list", "--state", "open", "--json", "number,url,title,author,headRefName,createdAt", "--limit", "30"],
    { cwd: root, maxBuffer: 1024 * 1024, timeout: 15_000 },
  );
  return JSON.parse(stdout) as GhPr[];
}

/**
 * Fire `pr_opened` routines for PRs opened since the last poll. The first poll per routine only records a
 * cursor. Thunk's own branches (`thunk/*`) are ignored so a routine that opens PRs can't trigger itself.
 */
export async function pollPullRequests() {
  const routines = await listEnabledRoutines({ event: "pr_opened" });
  const byProject = new Map<string, Routine[]>();
  for (const r of routines) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);

  for (const [projectId, list] of byProject) {
    const project = await getProject(projectId);
    if (!project?.remote || project.kind !== "repo") continue;
    let prs: GhPr[];
    try {
      prs = await openPrs(project.root);
    } catch (err) {
      console.error(`[thunk] PR poll failed for ${project.name}:`, (err as { stderr?: string }).stderr?.trim() || (err as Error).message);
      continue;
    }
    const newest = prs.reduce((max, pr) => (pr.createdAt > max ? pr.createdAt : max), "");
    for (const routine of list) {
      const st = routine.triggerState;
      if (!st.prSeenAt) {
        await updateRoutine(routine.id, { triggerState: { ...st, prSeenAt: newest || new Date().toISOString(), prSeen: prs.map((p) => p.number) } });
        continue;
      }
      const seen = new Set(st.prSeen ?? []);
      const fresh = prs
        .filter((pr) => pr.createdAt > st.prSeenAt! && !seen.has(pr.number) && !pr.headRefName.startsWith("thunk/"))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (!fresh.length) continue;
      for (const pr of fresh) seen.add(pr.number);
      await updateRoutine(routine.id, {
        triggerState: { ...st, prSeenAt: newest > st.prSeenAt ? newest : st.prSeenAt, prSeen: [...seen].slice(-SEEN_CAP) },
      });
      for (const pr of fresh) {
        await fire(routine, "pr_opened", {
          pr: { number: pr.number, url: pr.url, title: pr.title, author: pr.author?.login ?? null, branch: pr.headRefName },
        }).catch((err) => console.error("[thunk] pr_opened routine failed to start", err));
      }
    }
  }
}
