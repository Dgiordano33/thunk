"use client";
import { FolderIcon } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "sonner";
import { useLocalClient } from "@/components/mobile/local-client";

/** The scratch folder a repo-less project works in, drawn like the workspace panel's Files row. */
export function WorkspaceDirectory({ id, cwd }: { id: string; cwd: string }) {
  const local = useLocalClient();
  const path = <><FolderIcon className="size-3 shrink-0" /><span className="truncate">{cwd.replace(/^\/(Users|home)\/[^/]+/, "~")}</span></>;
  return <div className="mt-3 border px-3 py-2.5 text-xs">
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">Files</span>
      <span className="text-muted-foreground" title="A folder Thunk made for this project">Scratch folder</span>
    </div>
    {local ? <button
      type="button"
      title="Reveal in Finder"
      className="text-muted-foreground hover:text-foreground mt-1.5 flex max-w-full items-center gap-1 font-mono"
      onClick={() => void api.revealWorkspace(id).catch((err: Error) => toast.error("Couldn’t reveal the folder", { description: err.message }))}
    >{path}</button> : <p className="text-muted-foreground mt-1.5 flex max-w-full items-center gap-1 font-mono">{path}</p>}
  </div>;
}
