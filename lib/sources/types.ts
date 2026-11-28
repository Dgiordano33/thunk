// Client-safe: where a task came from, and a revision of that source with the chief's proposed task changes.
import type { Criterion } from "@/lib/tasks/types";

export type SourceKind = "document" | "note";

/** A task's link to the plan document or note it was delegated from. */
export type TaskSource = {
  taskId: string; kind: SourceKind; sourceId: string;
  /** Revisions Thunk has seen: 1 at delegation, one more per revision. */
  version: number;
  /** The version the worker was given (its brief, or the last approved <task_update>). */
  deliveredVersion: number;
  contentHash: string | null;
  /** The text last seen, the base for the next diff. */
  content: string | null;
};

/** What a report says it implements, stamped by Thunk when the worker reports. */
export type SourceStamp = { kind: SourceKind; sourceId: string; version: number; latest: number };

export type PlanChangeStatus = "waiting" | "open" | "applied" | "dismissed";
export type PlanChangeDecision = "pending" | "approved" | "rejected";
/** How an approved change reached the task's work. */
export type PlanChangeDelivery = "sent" | "queued" | "saved";

export type PlanChangeItem = {
  taskId: string; title: string;
  /** False: the chief judged this task unaffected by the revision. */
  affected: boolean;
  summary: string;
  /** The proposed brief and criteria, for affected tasks. Null criteria keeps the task's current ones. */
  brief: string | null;
  criteria: Criterion[] | null;
  /** The brief and criteria as they were when the change was proposed, to show what moves. */
  previousBrief: string | null;
  previousCriteria: Criterion[] | null;
  decision: PlanChangeDecision;
  delivery: PlanChangeDelivery | null;
};

export type PlanChange = {
  id: string; projectId: string; kind: SourceKind; sourceId: string; sourceTitle: string;
  version: number; diff: string; chiefSessionId: string | null; status: PlanChangeStatus;
  items: PlanChangeItem[];
  createdAt: string; updatedAt: string; resolvedAt: string | null;
};

/** One decision on the review screen: approve (optionally with an edited brief or criteria) or reject. */
export type PlanChangeChoice = { taskId: string; decision: "approved" | "rejected"; brief?: string; criteria?: { id?: string; text: string; kind?: Criterion["kind"] }[] | null };

export const planChangePath = (id: string) => `/inbox/plan-changes/${id}`;
export const sourceLabel = (kind: SourceKind) => kind === "document" ? "plan" : "note";
/** "Implements plan v3", the review card's stamp. */
export function stampLabel(stamp: SourceStamp) {
  return `Implements ${sourceLabel(stamp.kind)} v${stamp.version}`;
}

const KINDS: readonly string[] = ["test", "interaction", "visual", "source", "other"];
/** Criteria as editable lines, `kind: text`, one per criterion. */
export function criteriaToText(criteria: Criterion[] | null | undefined) {
  return (criteria ?? []).map((c) => `${c.kind}: ${c.text}`).join("\n");
}
/** Read edited criteria lines back. A line without a known `kind:` prefix is kind other; ids carry over by position. */
export function parseCriteriaText(text: string, previous: Criterion[] | null | undefined = []) {
  return text.split("\n").map((l) => l.trim().replace(/^[-*]\s*/, "")).filter(Boolean).map((line, i) => {
    const m = /^([a-z]+):\s*(.+)$/i.exec(line);
    const known = Boolean(m && KINDS.includes(m[1].toLowerCase()));
    return { ...(previous?.[i]?.id ? { id: previous[i].id } : {}), text: known ? m![2].trim() : line, kind: (known ? m![1].toLowerCase() : "other") as Criterion["kind"] };
  });
}
/** The unified diff's lines, each marked added, removed, a hunk header or context, for display. */
export function diffLines(diff: string): { kind: "add" | "remove" | "hunk" | "context"; text: string }[] {
  return diff.split("\n").filter((l) => !/^<\/?edits/.test(l) && !/^(---|\+\+\+) /.test(l)).map((text) => ({
    kind: text.startsWith("@@") ? "hunk" as const : text.startsWith("+") ? "add" as const : text.startsWith("-") ? "remove" as const : "context" as const, text,
  }));
}
