"use client";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

export function WorkspaceDirectory({ id, cwd }: { id: string; cwd: string }) {
  return <div className="mb-3 text-xs">
    <p className="break-all font-mono">{cwd}</p>
    <Button size="sm" variant="ghost" onClick={() => void api.revealWorkspace(id).catch((err: Error) => window.alert(err.message))}>Reveal in Finder</Button>
  </div>;
}
