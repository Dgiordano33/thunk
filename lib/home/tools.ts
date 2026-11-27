import "server-only";
import { z } from "zod";
import type { LiveSession } from "@/lib/agent";
import { ROUTE_STATUSES, RoutePlanObject } from "./schema";

type Tool = { name: string; description: string; schema: z.ZodRawShape; handler: (input: unknown) => Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> };
function define<S extends z.ZodRawShape>(name: string, description: string, schema: S, run: (input: z.infer<z.ZodObject<S>>) => Promise<unknown>): Tool {
  return { name, description, schema, async handler(input: unknown) {
    try {
      const result = await run(z.strictObject(schema).parse(input));
      return { content: [{ type: "text" as const, text: JSON.stringify(result) ?? "Done" }], isError: false };
    } catch (err) {
      return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
    }
  } };
}
const service = () => import("./service");

export { TOP_CHIEF_TOOL_NAMES } from "./prompt";

export function topChiefTools(live: LiveSession): Tool[] {
  if (live.meta.origin?.kind !== "top_chief") return [];
  return [
    define("projects_list", "Every project you can route to: id, name, its #tag, repos, active workspaces with their #project/workspace tags, open tasks, open routed requests and the start of its memory.", {}, async () => (await service()).projectsOverview()),
    define("note_items", "A top-level note's checklist items: line, text, whether it is done or already routed, and the project its #tag or ## heading pins it to.", { noteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i) }, async ({ noteId }) => (await service()).noteItems(noteId)),
    define("route_plan", "Propose where items go, for the person to approve in their inbox. Nothing is routed until they do. Items pinned by a tag or heading must go to that project. Pass noteId and each item's line so Thunk marks the note.", RoutePlanObject.shape, async (input) => (await service()).proposeRoutePlan(live.id, input)),
    define("routes_status", "Routed requests still open, those settled in the last week with their summaries, and plans waiting for approval.", {}, async () => (await service()).routesStatus()),
    define("routing_rule", "Save a routing rule you learned from the person (for example \"billing work goes to Payments\"). Rules live in your memory for future sessions.", { rule: z.string().trim().min(3).max(500) }, async ({ rule }) => (await service()).saveRoutingRule(rule)),
    define("top_log", "Append to today's top-level work log: routing outcomes, the daily summary, decisions.", { entry: z.string().trim().min(1).max(20_000) }, async ({ entry }) => {
      const { ensureHomeProject } = await service();
      const { appendWorkLog } = await import("@/lib/workers/log");
      return { path: (await appendWorkLog(await ensureHomeProject(), `[relay] ${entry}`))?.path };
    }),
  ];
}

/** A project chief's side of routing: settle a request the top chief sent. */
export function routeReportTool(live: LiveSession): Tool[] {
  if (live.meta.origin?.kind !== "chief") return [];
  return [define("route_report", "Settle a <routed_request> from the top chief, once, when its work is accepted, blocked or failed. The summary goes back to the top chief and onto the person's note.",
    { routeId: z.string().regex(/^[0-9a-f]{8}$/), status: z.enum(ROUTE_STATUSES), summary: z.string().trim().min(1).max(8000) },
    async ({ routeId, status, summary }) => (await service()).reportRoute(live.meta.projectId, routeId, status, summary))];
}

