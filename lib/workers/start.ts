import "server-only";
import { closeSession, startSession, pushUserMessage, type StartSessionInput } from "@/lib/agent";
import { expandCommand } from "@/lib/prompts/context";
import { sessionConfigRoot } from "@/lib/projects/repos";
import { upsertSession } from "@/lib/supabase/repo/sessions";

export async function startWorkerSession(input: StartSessionInput) {
  const live = await startSession(input);
  try {
    await upsertSession(live.meta);
    return live;
  } catch (err) {
    closeSession(live.id);
    throw err;
  }
}
export async function sendBrief(live: Awaited<ReturnType<typeof startSession>>, prompt: string) {
  pushUserMessage(live, prompt, { expandedContent: await expandCommand(prompt, sessionConfigRoot(live.ctx)) });
}
