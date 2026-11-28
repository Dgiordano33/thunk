// Client-safe: the messages a source revision sends to the chief and an approved change sends to a worker.
import { editsBlock, ensureNl, escapeXml } from "@/lib/revisions/build-payload";
import type { Criterion } from "@/lib/tasks/types";
import { sourceLabel, type SourceKind } from "./types";

const attr = (s: string) => escapeXml(s).replace(/"/g, "&quot;");
const FULL_TEXT_LIMIT = 40_000;

export type RevisedTask = { id: string; title: string; status: string; brief: string | null; criteria: Criterion[] | null; working: boolean };

const criteriaLines = (criteria: Criterion[] | null | undefined) => criteria?.length ? criteria.map((c) => `- ${c.id} (${c.kind}): ${c.text}`).join("\n") : "(none)";

/** The diff text stored with a plan change and shown on its card. */
export function sourceDiff(before: string, after: string) {
  return editsBlock(before, after, { names: ["before.md", "after.md"] });
}

/**
 * `<source_revision>`: a plan document or note that tasks were delegated from changed. The chief reads the diff and
 * the open tasks, then answers with tasks_revise. Nothing reaches a worker until the person approves.
 */
export function buildSourceRevisionPayload(input: { changeId: string; kind: SourceKind; sourceId: string; title: string; version: number; before: string; after: string; tasks: RevisedTask[] }) {
  const label = sourceLabel(input.kind);
  const after = ensureNl(input.after);
  const parts = [
    `<source_revision id="${attr(input.changeId)}" source="${input.kind}" source_id="${attr(input.sourceId)}" title="${attr(input.title)}" version="${input.version}">`,
    `The ${label} these tasks were delegated from changed (now v${input.version}). Decide what the change means for each task below, then call tasks_revise once with revisionId "${input.changeId}": for every task, either affected: false, or affected: true with a one-line summary of what changed for it, the complete new brief, and the new criteria (omit criteria to keep the current ones). Do not message workers about this yourself; the person approves each change in their Inbox and Thunk sends it on.`,
    "",
    sourceDiff(input.before, after),
    "",
  ];
  if (after.length <= FULL_TEXT_LIMIT) parts.push(`<current_${label}>`, after.trimEnd(), `</current_${label}>`, "");
  parts.push(`<tasks count="${input.tasks.length}">`);
  for (const t of input.tasks) {
    parts.push(`<task id="${attr(t.id)}" title="${attr(t.title)}" status="${t.status}"${t.working ? ' worker="running"' : ""}>`);
    parts.push("<brief>", escapeXml((t.brief ?? "").trimEnd()) || "(no brief)", "</brief>");
    parts.push("<criteria>", escapeXml(criteriaLines(t.criteria)), "</criteria>");
    parts.push("</task>");
  }
  parts.push("</tasks>", "</source_revision>");
  return parts.join("\n");
}

/** `<task_update>`: the person approved a change to a running worker's task. */
export function buildTaskUpdatePayload(input: { taskId: string; kind: SourceKind; version: number; summary: string; brief: string; criteria: Criterion[] | null; criteriaBrief: string | null }) {
  return [
    `<task_update task="${attr(input.taskId)}" source="${input.kind}" version="${input.version}">`,
    `The ${sourceLabel(input.kind)} for your task changed and the person approved this update: ${escapeXml(input.summary)}`,
    "This brief replaces the one you started with. Adjust what you have done so far to match it, keep work that still fits, and report as before when it is done.",
    "",
    "<brief>", escapeXml(input.brief.trimEnd()), "</brief>",
    ...(input.criteriaBrief ? ["", escapeXml(input.criteriaBrief)] : []),
    "</task_update>",
  ].join("\n");
}
