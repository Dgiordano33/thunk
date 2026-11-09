"use client";

import { FolderGit2Icon, FolderPlusIcon, GitForkIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { repoNameFromUrl, type RepoSpec } from "@/lib/projects/repo-spec";
import { cn } from "@/lib/utils";
import { DEFAULT_PARENT, Field, FolderPicker } from "./form-fields";

export type RepoDraft = { source: RepoSpec["source"]; path: string; url: string; parent: string; folder: string; git: boolean; name: string };

export const emptyDraft = (): RepoDraft => ({ source: "existing", path: "", url: "", parent: DEFAULT_PARENT, folder: "", git: true, name: "" });

export const draftReady = (d: RepoDraft) =>
  d.source === "existing" ? !!d.path.trim() : d.source === "github" ? !!d.url.trim() && !!d.parent.trim() : !!d.folder.trim() && !!d.parent.trim();

export function draftToSpec(d: RepoDraft): RepoSpec {
  const name = d.name.trim() || undefined;
  if (d.source === "existing") return { source: d.source, path: d.path, name };
  if (d.source === "github") return { source: d.source, url: d.url.trim(), parent: d.parent, name };
  return { source: d.source, parent: d.parent, folder: d.folder.trim(), git: d.git, name };
}

/** What a spec will be called once added, before the server has seen it. */
export function specTitle(spec: RepoSpec) {
  if (spec.name) return spec.name;
  if (spec.source === "github") return repoNameFromUrl(spec.url);
  return spec.source === "new" ? spec.folder : spec.path.replace(/\/+$/, "").split("/").pop() || spec.path;
}

const SOURCES = [
  { source: "existing", icon: FolderGit2Icon, label: "Existing" },
  { source: "github", icon: GitForkIcon, label: "Clone" },
  { source: "new", icon: FolderPlusIcon, label: "New folder" },
] as const;

/** Where one repo comes from: an existing checkout, a GitHub clone, or a new folder. */
export function RepoSourceFields({ draft, onChange, picking, onPicking, onError }: {
  draft: RepoDraft;
  onChange: (next: RepoDraft) => void;
  picking: boolean;
  onPicking: (picking: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const set = (patch: Partial<RepoDraft>) => onChange({ ...draft, ...patch });
  const pick = async (prompt: string, current: string, field: "path" | "parent") => {
    onError(null);
    onPicking(true);
    try {
      const picked = (await api.pickFolder({ prompt, defaultPath: current || undefined })).path;
      if (picked) set({ [field]: picked });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onPicking(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-lg border p-0.5" role="radiogroup" aria-label="Repo source">
        {SOURCES.map(({ source, icon: Icon, label }) => (
          <button
            key={source}
            type="button"
            role="radio"
            aria-checked={draft.source === source}
            onClick={() => set({ source })}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
              draft.source === source ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
      {draft.source === "existing" && (
        <Field label="Folder" hint="Inside a git repo, its main checkout is used (even from a worktree).">
          <FolderPicker value={draft.path} picking={picking} onPick={() => void pick("Choose a repo or folder", draft.path, "path")} />
        </Field>
      )}
      {draft.source === "github" && (
        <Field label="Repository URL" hint="HTTPS, SSH, or owner/repo shorthand.">
          <Input value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://github.com/owner/repo" className="font-mono text-sm" autoFocus />
        </Field>
      )}
      {draft.source === "new" && (
        <Field label="Folder name">
          <Input value={draft.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="my-repo" className="font-mono text-sm" autoFocus />
        </Field>
      )}
      {draft.source !== "existing" && (
        <Field label={draft.source === "github" ? "Clone into" : "Create inside"}>
          <FolderPicker
            value={draft.parent}
            picking={picking}
            onPick={() => void pick(draft.source === "github" ? "Choose where to clone the repo" : "Choose where to create the folder", draft.parent, "parent")}
          />
        </Field>
      )}
      {draft.source === "new" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.git} onChange={(e) => set({ git: e.target.checked })} className="accent-primary size-4" />
          Initialize a git repository
        </label>
      )}
      <Field label="Name (optional)" hint="How agents and the UI refer to it. Defaults to the folder name.">
        <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="api" className="font-mono text-sm" />
      </Field>
    </div>
  );
}
