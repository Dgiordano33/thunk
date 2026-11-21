"use client";
import { useAgentStatus } from "@/components/onboarding/agent-status";

import { useEffect, useState } from "react";
import { CLAUDE_MODELS, type ModelOption } from "@/lib/agent/types";
import { api } from "@/lib/client/api";

let cache: Promise<ModelOption[]> | null = null;
let agentStatus: ReturnType<typeof useAgentStatus>;

/** Claude models right away; Codex models join once the server has asked the local Codex install. */
export function useModels(): ModelOption[] {
  const status = useAgentStatus();
  const [models, setModels] = useState<ModelOption[]>(CLAUDE_MODELS);
  useEffect(() => {
    if (agentStatus !== status) { cache = null; agentStatus = status; }
    cache ??= api.listModels().then(
      (r) => r.models,
      () => {
        cache = null;
        return CLAUDE_MODELS;
      },
    );
    let alive = true;
    void cache.then((m) => alive && setModels(m));
    return () => {
      alive = false;
    };
  }, [status]);
  return models;
}
