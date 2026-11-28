// Client-safe: evidence rows, the worker's claimed-evidence format, and when a row covers an older revision.
import type { Criterion } from "@/lib/tasks/types";

export const EVIDENCE_TYPES = ["test", "ci", "merge", "preview", "screenshot", "source", "note"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export const EVIDENCE_STATUSES = ["pass", "fail", "unknown"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
/** Only Thunk writes observed rows; claimed rows come from an agent's report. */
export type EvidenceOrigin = "observed" | "claimed";
/** What a worker may claim. Merge, CI and preview results are only ever observed. */
export const CLAIMED_TYPES: readonly EvidenceType[] = ["test", "screenshot", "source", "note"];

export type Evidence = {
  id: string; taskId: string; criterionId: string | null;
  origin: EvidenceOrigin; type: EvidenceType; status: EvidenceStatus;
  detail: string; ref: string | null;
  /** The commit the row covers. */
  commitSha: string | null;
  /** The task's criteria_version when the row was written. */
  criteriaVersion: number;
  sessionId: string | null; createdAt: string;
};
export type NewEvidence = Omit<Evidence, "id" | "createdAt"> & { createdAt?: string };
/** A row as the review card shows it: why it may no longer describe the work. */
export type ReviewEvidence = Evidence & { stale: null | "commit" | "criteria" };

/**
 * A row covers an older revision when the branch head has moved past its commit, or the task's
 * criteria changed after it was written. `heads` are the workspace's current branch heads.
 */
export function staleness(row: Evidence, heads: (string | null)[], criteriaVersion: number): ReviewEvidence["stale"] {
  const known = heads.filter((h): h is string => Boolean(h));
  if (row.commitSha && known.length && !known.includes(row.commitSha)) return "commit";
  if (row.criteriaVersion < criteriaVersion) return "criteria";
  return null;
}

/** Which observed rows speak to a criterion of this kind, beside the claims made for it. */
export function observedFor(kind: Criterion["kind"]): EvidenceType[] {
  if (kind === "test") return ["test", "ci", "merge"];
  if (kind === "visual" || kind === "interaction") return ["preview", "screenshot"];
  if (kind === "source") return ["source"];
  return [];
}

const SUMMARY_FENCE = /```worker-summary\s*\n([\s\S]*?)```/g;
const FIELD = /^[a-z_]+:/i;

/** The lines of the last worker-summary block's `evidence:` field. */
function evidenceLines(markdown: string): string[] {
  const block = [...markdown.matchAll(SUMMARY_FENCE)].at(-1)?.[1];
  if (!block) return [];
  const lines = block.split("\n");
  const start = lines.findIndex((l) => /^evidence:/i.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  const inline = lines[start].trim().replace(/^evidence:\s*/i, "");
  if (inline && !/^none\.?$/i.test(inline)) out.push(inline);
  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (!t) continue;
    if (FIELD.test(t) && !/^-/.test(t) && !/^[a-z0-9_-]{1,20}\s*\|/i.test(t)) break;
    out.push(t.replace(/^[-*]\s*/, ""));
  }
  return out;
}

/** Remove the `evidence:` field from worker-summary blocks, so it does not run into the summary. */
export function stripEvidence(markdown: string): string {
  return markdown.replace(SUMMARY_FENCE, (whole, body: string) => {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => /^evidence:/i.test(l.trim()));
    if (start < 0) return whole;
    let end = start + 1;
    while (end < lines.length && !(FIELD.test(lines[end].trim()) && !/^-/.test(lines[end].trim()) && !/^[a-z0-9_-]{1,20}\s*\|/i.test(lines[end].trim()))) end++;
    const rest = lines.slice(end);
    return whole.replace(body, [...lines.slice(0, start), ...rest.length ? rest : [""]].join("\n"));
  });
}

export type ClaimedLine = Pick<Evidence, "criterionId" | "type" | "status" | "detail" | "ref">;

/**
 * Parse the worker's evidence lines: `- <criterion id> | pass|fail|unknown | test|screenshot|source|note | what shows it | path or URL`.
 * Unknown criterion ids become general notes; an unreadable status is "unknown". Lines without pipes are kept as notes.
 */
export function parseClaimedEvidence(markdown: string, criteria: Pick<Criterion, "id">[] = []): ClaimedLine[] {
  const ids = new Set(criteria.map((c) => c.id));
  return evidenceLines(markdown).flatMap((line): ClaimedLine[] => {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) {
      const m = /^([a-z0-9_-]{1,20})\s*[:—-]\s*(.+)$/i.exec(line);
      if (!m) return line ? [{ criterionId: null, type: "note", status: "unknown", detail: line.slice(0, 2000), ref: null }] : [];
      return [{ criterionId: ids.has(m[1]) ? m[1] : null, type: "note", status: "unknown", detail: m[2].slice(0, 2000), ref: null }];
    }
    const [id, status, type, detail = "", ref = ""] = parts;
    const lower = (s: string) => s.toLowerCase();
    return [{
      criterionId: ids.has(id) ? id : null,
      status: (EVIDENCE_STATUSES as readonly string[]).includes(lower(status)) ? lower(status) as EvidenceStatus : "unknown",
      type: CLAIMED_TYPES.includes(lower(type) as EvidenceType) ? lower(type) as EvidenceType : "note",
      detail: (detail || (ids.has(id) ? "" : id)).slice(0, 2000),
      ref: ref && !/^none$/i.test(ref) ? ref.slice(0, 1000) : null,
    }];
  });
}
