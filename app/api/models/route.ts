import { handle } from "@/lib/api/http";
import { listCodexModels } from "@/lib/agent/codex/models";
import { CLAUDE_MODELS } from "@/lib/agent/types";

export const dynamic = "force-dynamic";

/** Claude models are fixed; Codex models come from the local Codex install, if it's there and signed in. */
export const GET = handle(async () => {
  const codex = await listCodexModels().then(
    (models) => ({ models, error: null }),
    (err: Error) => ({ models: [], error: err.message }),
  );
  return Response.json({ models: [...CLAUDE_MODELS, ...codex.models], codexError: codex.error });
});
