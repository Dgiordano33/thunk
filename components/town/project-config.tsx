"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";

export function ProjectConfig({ id }: { id: string }) {
  const [instructions, setInstructions] = useState("");
  const [original, setOriginal] = useState("");
  const [connectors, setConnectors] = useState("");
  const [revision, setRevision] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([api.projectInstructions(id), api.projectConnectors(id)]).then(([i, c]) => {
      if (!active) return;
      setInstructions(i.content); setOriginal(i.content);
      setConnectors(JSON.stringify(c.config, null, 2)); setRevision(c.revision);
      setError(c.error ?? ""); setLoaded(true);
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [id]);

  async function save(kind: "instructions" | "connectors") {
    setBusy(true); setError(""); setMessage("");
    try {
      if (kind === "instructions") {
        await api.saveProjectInstructions(id, instructions, original);
        setOriginal(instructions);
      } else {
        let config: unknown;
        try { config = JSON.parse(connectors); } catch { throw new Error("Enter valid connector JSON."); }
        await api.saveProjectConnectors(id, config, revision!);
        const saved = await api.projectConnectors(id);
        setConnectors(JSON.stringify(saved.config, null, 2)); setRevision(saved.revision);
      }
      setMessage("Saved. Changes apply to new sessions.");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="flex flex-col gap-3">
    <label className="text-sm font-medium">Instructions
      <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={!loaded || busy} maxLength={200_000} className="mt-1 min-h-32 text-xs" />
    </label>
    <p className="text-muted-foreground text-xs">Guidance for every session, alongside repository instructions. The first 24,000 characters are included; use memory for what the project learns.</p>
    <Button size="sm" variant="outline" className="self-start" disabled={!loaded || busy || instructions === original} onClick={() => void save("instructions")}>Save instructions</Button>
    <label className="text-sm font-medium">Connectors
      <Textarea value={connectors} onChange={(e) => setConnectors(e.target.value)} disabled={!loaded || busy} className="mt-1 min-h-40 font-mono text-xs" spellCheck={false} />
    </label>
    <p className="text-muted-foreground text-xs">Configure mcpServers with stdio command/args/env or http url/headers. Legacy sse connectors work in Claude sessions only. Keep masked values to retain saved secrets. Tokens are stored locally in plain text. Unrestricted agents can edit these files.</p>
    <Button size="sm" variant="outline" className="self-start" disabled={!loaded || busy || revision === null} onClick={() => void save("connectors")}>Save connectors</Button>
    {message && <p role="status" className="text-xs">{message}</p>}
    {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
  </div>;
}
