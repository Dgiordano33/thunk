import { handle, HttpError } from "@/lib/api/http";
import { linearSettings } from "@/lib/integrations/config";
import { linearClient, LinearError } from "@/lib/integrations/linear/client";

export const dynamic = "force-dynamic";

/** Who the saved key belongs to, and the teams it can see, for the project → team pickers. */
export const GET = handle(async () => {
  const { apiKey } = await linearSettings();
  if (!apiKey) throw new HttpError(400, "Save a Linear API key first.");
  const client = linearClient(apiKey);
  try {
    const [viewer, teams] = await Promise.all([client.viewer(), client.teams()]);
    return Response.json({ viewer, teams: teams.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (error) {
    if (error instanceof LinearError) throw new HttpError(400, error.message);
    throw error;
  }
});
