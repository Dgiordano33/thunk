import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { listProjects } from "@/lib/db/repo/projects";
import { linearSettings, updateLinearSettings } from "@/lib/integrations/config";
import { linearSyncStatus, pollLinear } from "@/lib/integrations/linear/service";
import { linearClient, LinearError } from "@/lib/integrations/linear/client";

export const dynamic = "force-dynamic";

async function status() {
  const s = await linearSettings();
  const projects = await listProjects().catch(() => []);
  return {
    hasKey: Boolean(s.apiKey),
    keyHint: s.apiKey ? `…${s.apiKey.slice(-4)}` : null,
    keyFromEnv: s.keyFromEnv,
    projects: projects.map((p) => ({ id: p.id, name: p.name, team: s.projects[p.id] ?? null, sync: linearSyncStatus(p.id) })),
  };
}

/** Linear settings for Settings → Integrations. The key never leaves the server. */
export const GET = handle(async () => Response.json(await status()));

export const PUT = handle(async (req: Request) => {
  const body = await parseBody(req, z.object({
    apiKey: z.string().max(200).optional(),
    projects: z.record(z.string(), z.string().nullable()).optional(),
  }));
  try {
    // Check a new key before saving it, so a typo never replaces a working key.
    if (body.apiKey?.trim()) await linearClient(body.apiKey.trim()).viewer();
    let links: Record<string, { teamId: string; teamKey: string; teamName: string } | null> | undefined;
    if (body.projects) {
      const key = body.apiKey?.trim() || (await linearSettings()).apiKey;
      if (!key) throw new HttpError(400, "Save a Linear API key first.");
      const teams = await linearClient(key).teams();
      links = Object.fromEntries(Object.entries(body.projects).map(([projectId, teamId]) => {
        if (!teamId) return [projectId, null];
        const team = teams.find((t) => t.id === teamId);
        if (!team) throw new HttpError(400, "That Linear team was not found.");
        return [projectId, { teamId: team.id, teamKey: team.key, teamName: team.name }];
      }));
    }
    await updateLinearSettings({ ...(body.apiKey !== undefined ? { apiKey: body.apiKey } : {}), ...(links ? { projects: links } : {}) });
  } catch (error) {
    if (error instanceof LinearError) throw new HttpError(400, error.message);
    throw error;
  }
  if (body.projects) void pollLinear();
  return Response.json(await status());
});
