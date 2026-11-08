import "server-only";
import { z } from "zod";
import { notify } from "./service";
export function notificationTools(ctx: { projectId: string; workspaceId: string; sessionId: string }) {
  const schema = { title: z.string().trim().min(1).max(200), detail: z.string().max(20000).optional(), urgency: z.enum(["action", "info"]).optional() };
  return [{ name: "notify", description: "Send the person a notification in their inbox. Use action when you need their help, info for an update.", schema,
    async handler(input: unknown) {
      try {
        const args = z.strictObject(schema).parse(input);
        const row = await notify({ ...ctx, ...args, urgency: args.urgency ?? "action", kind: "agent_request",
          subjectKey: `session:${ctx.sessionId}:agent:${crypto.randomUUID()}`, href: `/w/${ctx.workspaceId}/s/${ctx.sessionId}` });
        return { content: [{ type: "text" as const, text: `Notification created: ${row.id}` }], isError: false };
      } catch (err) { return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true }; }
    },
  }];
}
