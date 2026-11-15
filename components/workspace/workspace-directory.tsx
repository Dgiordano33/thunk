"use client";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { toast } from "sonner";

export function WorkspaceDirectory({ id, cwd }: { id: string; cwd: string }) {
  return <div className="mb-3 text-xs">
    <p className="break-all font-mono">{cwd}</p>
    <Button size="sm" variant="ghost" onClick={() => void api.revealWorkspace(id).catch((err: Error) => toast.error("Couldn’t reveal the folder", { description: err.message }))}>Reveal in Finder</Button>
  </div>;
}
