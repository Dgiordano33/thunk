import "server-only";
import { HttpError } from "@/lib/api/errors";
import { getProject } from "@/lib/db/repo/projects";
import { getMemoryProposal, insertMemoryProposal, listMemoryProposals, updateMemoryProposal, type ItemPatch, type NewMemoryProposal } from "@/lib/db/repo/memory-proposals";
import { NoteConflictError } from "@/lib/notes/file-write";
import { projectNoteDirs } from "@/lib/notes/resolve";
import { emitNote } from "@/lib/notes/watch";
import { notify, resolveBySubject } from "@/lib/notifications/service";
import { readMemory, writeMemory } from "@/lib/projects/memory";
import { projectMemoryFile } from "@/lib/projects/paths";
import type { Project } from "@/lib/projects/types";
import { composeMemory, type ComposeItem } from "./compose";
import { entryKey, memoryHash, readSidecar, updateSidecar } from "./sidecar";
import { MEMORY_OP_LABELS, WORKAROUND_REVIEW_DAYS, memoryProposalPath, type MemoryItemChoice, type MemoryProposal, type MemoryProposalItem, type MemoryProposalOrigin } from "./types";

/** An HttpError, so routes return it as is. */
export class MemoryProposalError extends HttpError {
  constructor(message: string, status = 400) { super(status, message); }
}

export const proposalSubject = (id: string) => `memory-proposal:${id}`;

async function projectOf(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new MemoryProposalError("Project not found", 404);
  return project;
}

const ORIGIN_LABELS: Record<MemoryProposalOrigin, string> = { harvest: "Harvest", upkeep: "Memory upkeep", agent: "Agent" };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const oneLine = (text: string | null, max = 90) => { const line = (text ?? "").replace(/\s+/g, " ").trim(); return line.length > max ? `${line.slice(0, max - 1)}…` : line; };

export type ProposeInput = { summary?: string | null; items: NewMemoryProposal["items"] };
export type ProposeContext = { projectId: string; origin: MemoryProposalOrigin; workspaceId?: string | null; sessionId?: string | null; runId?: string | null };

/**
 * Record a proposal against current project memory and put its card in the Inbox. A replace or remove whose target isn't
 * in memory is refused, so the agent can fix it while it still has the context. No items records an empty proposal: a
 * run that found nothing resolves quietly, with no card.
 */
export async function proposeMemory(ctx: ProposeContext, input: ProposeInput) {
  const project = await projectOf(ctx.projectId);
  const current = await readMemory(projectMemoryFile(project.dataKey));
  const items = input.items.map((item) => ({ ...item, reviewAfter: item.kind === "workaround" ? item.reviewAfter ?? null : null }));
  const { outcomes } = composeMemory(current, items.map((item, i) => ({ id: String(i), op: item.op, target: item.target, text: item.text })));
  const missing = outcomes.filter((o) => o.flag && o.flag !== "Already in memory").map((o) => `item ${Number(o.id) + 1}: ${o.flag}`);
  if (missing.length) throw new MemoryProposalError(`Nothing was proposed. Fix these items and call memory_propose again (target must be the exact existing text): ${missing.join("; ")}`);
  const base = { projectId: project.id, origin: ctx.origin, workspaceId: ctx.workspaceId ?? null, sessionId: ctx.sessionId ?? null, runId: ctx.runId ?? null,
    baseHash: memoryHash(current), summary: input.summary?.trim() || null };
  if (!items.length) return insertMemoryProposal({ ...base, items: [], status: "empty" });
  const proposal = await insertMemoryProposal({ ...base, items });
  const counts = (["add", "replace", "remove"] as const).map((op) => [op, items.filter((i) => i.op === op).length] as const).filter(([, n]) => n);
  // No sessionId: the card leads to the review screen, not to a reply in the proposing session.
  await notify({ kind: "memory_proposal", urgency: "action", projectId: project.id, workspaceId: base.workspaceId, runId: base.runId,
    subjectKey: proposalSubject(proposal.id), title: `${ORIGIN_LABELS[ctx.origin]} · ${plural(items.length, "memory change")}`,
    detail: [proposal.summary, counts.map(([op, n]) => `${MEMORY_OP_LABELS[op]} ${n}`).join(" · "), ...items.slice(0, 5).map((i) => `- ${MEMORY_OP_LABELS[i.op]}: ${oneLine(i.text ?? i.target)}`)].filter(Boolean).join("\n"),
    href: memoryProposalPath(proposal.id) });
  return proposal;
}

/** What the review screen shows: the proposal, memory as it is now, and its hash for Apply. */
export async function reviewMemoryProposal(id: string) {
  const proposal = await getMemoryProposal(id);
  if (!proposal) throw new MemoryProposalError("Proposal not found", 404);
  const project = await projectOf(proposal.projectId);
  const memory = await readMemory(projectMemoryFile(project.dataKey));
  return { proposal, project: { id: project.id, name: project.name, slug: project.slug }, memory, memoryHash: memoryHash(memory), sidecar: await readSidecar(project.dataKey) };
}
export type MemoryReview = Awaited<ReturnType<typeof reviewMemoryProposal>>;

const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function recordSources(project: Project, proposal: MemoryProposal, applied: { item: MemoryProposalItem; text: string | null }[]) {
  if (!applied.length) return;
  const now = new Date().toISOString();
  await updateSidecar(project.dataKey, (sidecar) => {
    for (const { item, text } of applied) {
      const previous = item.target ? sidecar[entryKey(item.target)] : undefined;
      if (item.target) delete sidecar[entryKey(item.target)];
      if (item.op === "remove" || !text) continue;
      const sources = [...(previous?.sources ?? []), ...item.sources].filter((s, i, all) => all.findIndex((o) => o.type === s.type && o.id === s.id) === i);
      sidecar[entryKey(text)] = {
        kind: item.kind ?? previous?.kind ?? null, sources, ...(item.reason ? { reason: item.reason } : {}),
        reviewAfter: item.kind === "workaround" ? item.reviewAfter ?? addDays(WORKAROUND_REVIEW_DAYS) : null,
        proposalId: proposal.id, excerpt: oneLine(text, 80), updatedAt: now,
      };
    }
  });
}

export type ApplyInput = { choices: MemoryItemChoice[]; memoryHash: string; document?: string };
export type ApplyResult = { applied: true; proposal: MemoryProposal } | { applied: false; changed: boolean; review: MemoryReview };

/**
 * Write the accepted items through writeMemory's expected-content check. Items are re-matched by target against memory as
 * it is now, so a change made since the review loaded is fine as long as every accepted target is still there; any that
 * aren't are flagged and nothing is written. A hand-edited document can't be re-matched, so it needs memory unchanged.
 */
export async function applyMemoryProposal(id: string, input: ApplyInput): Promise<ApplyResult> {
  const proposal = await getMemoryProposal(id);
  if (!proposal) throw new MemoryProposalError("Proposal not found", 404);
  if (proposal.status !== "open") throw new MemoryProposalError(`This proposal was already ${proposal.status}`, 409);
  const project = await projectOf(proposal.projectId);
  const file = projectMemoryFile(project.dataKey);
  const choice = new Map(input.choices.map((c) => [c.id, c]));
  const accepted = proposal.items.filter((item) => choice.get(item.id)?.decision === "accepted");
  const textOf = (item: MemoryProposalItem) => item.op === "remove" ? null : choice.get(item.id)?.text?.trim() || item.text;
  const decisions: ItemPatch[] = proposal.items.map((item) => {
    const c = choice.get(item.id);
    const edited = c?.text?.trim() && c.text.trim() !== item.text?.trim() ? c.text.trim() : null;
    return { id: item.id, decision: c?.decision ?? "rejected", editedText: edited };
  });
  if (!accepted.length) throw new MemoryProposalError("Accept at least one change, or reject the proposal");

  const current = await readMemory(file);
  const changed = memoryHash(current) !== input.memoryHash;
  let next: string;
  if (input.document !== undefined) {
    if (changed) throw new MemoryProposalError("Project memory changed while you were editing. Copy your edits, reload, and apply again.", 409);
    // A blank document over non-empty memory is almost always an editor that hadn't loaded, not an intent to wipe it.
    if (!input.document.trim() && current.trim()) throw new MemoryProposalError("The document is empty. Reload and apply again, or edit project memory directly.");
    next = input.document.endsWith("\n") ? input.document : `${input.document}\n`;
  } else {
    const items: ComposeItem[] = accepted.map((item) => ({ id: item.id, op: item.op, target: item.target, text: textOf(item) }));
    const result = composeMemory(current, items);
    const flagged = result.outcomes.filter((o) => o.flag);
    if (flagged.length) {
      await updateMemoryProposal(id, { baseHash: memoryHash(current) }, decisions.map((d) => ({ ...d, flag: flagged.find((o) => o.id === d.id)?.flag ?? null })));
      return { applied: false, changed, review: await reviewMemoryProposal(id) };
    }
    next = result.content;
  }
  try {
    await writeMemory(file, next, current);
  } catch (err) {
    if (err instanceof NoteConflictError) throw new MemoryProposalError("Project memory changed while applying. Apply again to re-match the changes.", 409);
    throw err;
  }
  // In a document, an item counts as applied when its text made it in (or, for a remove, its target is gone).
  const landed = accepted.filter((item) => input.document === undefined || (item.op === "remove" ? !next.includes(item.target ?? "") : next.includes(textOf(item)?.trim() ?? "\u0000")));
  await recordSources(project, proposal, landed.map((item) => ({ item, text: textOf(item) })));
  emitNote({ scope: projectNoteDirs(project).scope, noteId: "memory", kind: "changed" });
  const updated = await updateMemoryProposal(id, { status: "applied", baseHash: memoryHash(next) }, decisions.map((d) => ({ ...d, flag: null })));
  await resolveBySubject(proposalSubject(id));
  return { applied: true, proposal: updated! };
}

export async function rejectMemoryProposal(id: string) {
  const proposal = await getMemoryProposal(id);
  if (!proposal) throw new MemoryProposalError("Proposal not found", 404);
  if (proposal.status !== "open") throw new MemoryProposalError(`This proposal was already ${proposal.status}`, 409);
  const updated = await updateMemoryProposal(id, { status: "rejected" }, proposal.items.map((item) => ({ id: item.id, decision: "rejected" as const })));
  await resolveBySubject(proposalSubject(id));
  return updated!;
}

/** Whether a routine run left a proposal (or recorded that it had none): its card, or nothing, stands in for the run notice. */
export async function runProposed(runId: string) {
  return (await listMemoryProposals({ runId })).length > 0;
}
