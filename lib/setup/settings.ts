import "server-only";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sharedConfigDir } from "@/lib/projects/paths";

/** Thunk-wide agent settings, in `~/.thunk/config/agents.json`. */
const AgentSettings = z.object({
  /** Load this machine's own `~/.claude` (settings, skills, plugins, user MCP servers) into Claude sessions. */
  claudeUserConfig: z.boolean().default(false),
});
export type AgentSettings = z.infer<typeof AgentSettings>;

const file = () => path.join(sharedConfigDir(), "agents.json");

export async function readAgentSettings(): Promise<AgentSettings> {
  try {
    return AgentSettings.parse(JSON.parse(await readFile(file(), "utf8")));
  } catch {
    return AgentSettings.parse({});
  }
}

export async function updateAgentSettings(patch: Partial<AgentSettings>): Promise<AgentSettings> {
  const next = AgentSettings.parse({ ...(await readAgentSettings()), ...patch });
  await mkdir(sharedConfigDir(), { recursive: true, mode: 0o700 });
  await writeFile(file(), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  await chmod(file(), 0o600);
  return next;
}
