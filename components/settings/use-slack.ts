"use client";
import { useCallback, useEffect, useState } from "react";
import type { PublicSlack } from "@/lib/integrations/config";

/** Slack settings as the server reports them (never the token). */
export function useSlack() {
  const [slack, setSlack] = useState<PublicSlack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/slack", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      setSlack(data); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load Slack settings"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (patch: { botToken?: string; userId?: string; enabled?: boolean }) => {
    const response = await fetch("/api/integrations/slack", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save");
    setSlack(data);
    return data as PublicSlack;
  };
  const connected = Boolean(slack?.hasToken && slack.userId && slack.enabled);
  return { slack, error, save, reload: load, connected };
}
