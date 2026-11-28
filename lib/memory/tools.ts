import "server-only";
import { z } from "zod";
import type { SessionOrigin } from "@/lib/agent/types";
import { MEMORY_KINDS, MEMORY_OPS, memoryProposalPath } from "./types";

export const MEMORY_TOOL_NAMES = ["memory_propose"];

const source = z.object({ type: z.enum(["task", "session", "note", "workspace"]), id: z.string().trim().min(1).max(200), label: z.string().max(200).optional() });
const item = z.object({
  op: z.enum(MEMORY_OPS),
  target: z.string().max(20_000).optional().describe("For replace and remove: the exact existing text in MEMORY.md, copied character for character."),
  text: z.string().max(20_000).optional().describe("For add and replace: the new entry, as it should read in MEMORY.md."),
  kind: z.enum(MEMORY_KINDS).optional().describe("decision: a durable choice or fact. workaround: a fix for something that may be fixed later."),
  reason: z.string().trim().min(1).max(2000).describe("Why this change, in one or two sentences."),
  sources: z.array(source).max(20).optional().describe("Tasks, sessions, notes or workspaces this came from."),
  reviewAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Workarounds only: when to check whether it is still needed (YYYY-MM-DD). Defaults to 90 days."),
}).superRefine((value, ctx) => {
  if (value.op !== "remove" && !value.text?.trim()) ctx.addIssue({ code: "custom", message: `${value.op} needs text` });
  if (value.op !== "add" && !value.target?.trim()) ctx.addIssue({ code: "custom", message: `${value.op} needs target` });
});
const schema = {
  summary: z.string().max(2000).optional().describe("One line on what the proposal does overall."),
  items: z.array(item).max(50).describe("The changes. An empty list records that nothing needs changing."),
};

/** Which flow a proposal came from, by the session that made it. */
function originOf(origin: SessionOrigin | null | undefined) {
  if (origin?.kind === "memory") return { origin: "harvest" as const };
  if (origin?.kind === "routine") return { origin: "upkeep" as const, runId: origin.runId };
  return { origin: "agent" as const };
}

/** memory_propose: every session can suggest a change to project memory; the person reviews it before anything is written. */
export function memoryTools(ctx: { projectId: string; workspaceId: string; sessionId: string; origin?: SessionOrigin | null }) {
  return [{
    name: "memory_propose",
    description: "Propose changes to project memory (MEMORY.md) for the person to review. Nothing is written until they apply it. Each item adds an entry, replaces one (target = exact existing text), or removes one. Give a reason, the kind (decision or workaround) and sources for each. Call it once with every change; call it with no items when nothing needs changing.",
    schema,
    async handler(input: unknown) {
      try {
        const args = z.object(schema).parse(input);
        const { proposeMemory } = await import("./service");
        const proposal = await proposeMemory({ projectId: ctx.projectId, workspaceId: ctx.workspaceId, sessionId: ctx.sessionId, ...originOf(ctx.origin) }, {
          summary: args.summary,
          items: args.items.map((i) => ({ op: i.op, target: i.op === "add" ? null : i.target!, text: i.op === "remove" ? null : i.text!.trim(), kind: i.kind ?? null, reason: i.reason, sources: i.sources ?? [], reviewAfter: i.reviewAfter ?? null })),
        });
        const text = proposal.status === "empty" ? "Nothing to propose: recorded, no card was created." : `Proposal created with ${proposal.items.length} change(s); it waits for review in the Inbox at ${memoryProposalPath(proposal.id)}. Do not edit MEMORY.md yourself.`;
        return { content: [{ type: "text" as const, text }], isError: false };
      } catch (err) {
        const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (err as Error).message;
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    },
  }];
}
