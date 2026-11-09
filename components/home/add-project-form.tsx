"use client";

import { CheckIcon, CircleAlertIcon, FolderGit2Icon, FolderPlusIcon, GitForkIcon, Loader2Icon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { draftReady, draftToSpec, emptyDraft, RepoSourceFields, specTitle, type RepoDraft } from "@/components/project/repo-source-form";
import { Field } from "@/components/project/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import type { RepoSpec } from "@/lib/projects/repo-spec";

type Row = { key: number; spec: RepoSpec; status: "draft" | "adding" | "added" | "failed"; error?: string };

const SOURCE_ICON = { existing: FolderGit2Icon, github: GitForkIcon, new: FolderPlusIcon };

/** The create-project wizard: a name and any number of repos, zero included. */
export function AddProjectForm({ size = "default" }: { size?: "default" | "lg" }) {
  const router = useRouter();
  const nextKey = useRef(0);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<RepoDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the project exists but some repos failed: the dialog stays open to retry them.
  const [projectId, setProjectId] = useState<string | null>(null);

  const reset = () => {
    setName(""); setNameEdited(false); setRows([]); setDraft(null); setError(null); setPending(false); setProjectId(null);
  };

  const onOpenChange = (next: boolean) => {
    if (pending || picking) return;
    setOpen(next);
    if (!next) {
      if (projectId) router.refresh();
      reset();
    }
  };

  const goToProject = (id: string) => {
    router.push(`/p/${id}`);
    router.refresh();
  };

  const addRow = () => {
    if (!draft || !draftReady(draft)) return;
    const spec = draftToSpec(draft);
    // The first repo names an unnamed project, so pick-a-folder then Create stays two steps.
    if (!rows.length && !nameEdited) setName(specTitle(spec));
    setRows([...rows, { key: nextKey.current++, spec, status: "draft" }]);
    setDraft(null);
    setError(null);
  };

  const canCreate = !!name.trim() && !pending && !picking;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft) return addRow();
    if (!canCreate || projectId) return;
    setError(null);
    setPending(true);
    try {
      const result = await api.createProject({ name: name.trim(), repos: rows.map((r) => r.spec) });
      if (result.repos.every((r) => r.status === "added")) return goToProject(result.project.id);
      setProjectId(result.project.id);
      setRows(rows.map((row, i) => {
        const outcome = result.repos[i];
        return { ...row, status: outcome.status, error: outcome.status === "failed" ? outcome.error : undefined };
      }));
      setPending(false);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  const retry = async (key: number, spec: RepoSpec) => {
    if (!projectId) return;
    const update = (patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    update({ status: "adding", error: undefined });
    try {
      await api.addProjectRepo(projectId, spec);
      update({ status: "added" });
    } catch (err) {
      update({ status: "failed", error: (err as Error).message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size={size}>
          <PlusIcon />
          Add project
        </Button>
      </DialogTrigger>
      <DialogContent className="grid-cols-1 sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{projectId ? `${name} is ready` : "Create a project"}</DialogTitle>
            <DialogDescription>
              {projectId ? "Some repositories couldn't be added. Retry them here, or add them later from the project." : "Name it, then bring in as many repositories as it spans."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Field label="Project name">
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setNameEdited(true); }}
                placeholder="My project"
                maxLength={80}
                disabled={!!projectId}
                autoFocus
              />
            </Field>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Repositories</span>
              {rows.length === 0 && !draft && <p className="text-muted-foreground text-xs">A project can start without repos.</p>}
              {rows.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {rows.map((row) => {
                    const Icon = SOURCE_ICON[row.spec.source];
                    return (
                      <li key={row.key} className="rounded-lg border px-2.5 py-1.5 text-sm">
                        <div className="flex items-center gap-2">
                          <Icon className="text-muted-foreground size-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate font-mono">{specTitle(row.spec)}</span>
                          {row.status === "added" && <CheckIcon aria-label="Added" className="size-4 shrink-0" />}
                          {row.status === "adding" && <Loader2Icon aria-label="Adding" className="text-muted-foreground size-4 shrink-0 animate-spin" />}
                          {row.status === "failed" && (
                            <>
                              <CircleAlertIcon aria-hidden className="text-destructive size-4 shrink-0" />
                              <Button type="button" size="xs" variant="outline" onClick={() => void retry(row.key, row.spec)}>
                                <RotateCwIcon /> Retry
                              </Button>
                            </>
                          )}
                          {!projectId && (
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Remove ${specTitle(row.spec)}`}
                              disabled={pending}
                              onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
                            >
                              <XIcon />
                            </Button>
                          )}
                        </div>
                        {row.error && <p role="alert" className="text-destructive mt-1 text-xs">{row.error}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {!projectId && (draft ? (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <RepoSourceFields draft={draft} onChange={setDraft} picking={picking} onPicking={setPicking} onError={setError} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={picking}>Cancel</Button>
                    <Button type="submit" size="sm" variant="outline" disabled={!draftReady(draft) || picking}>Add to list</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setDraft(emptyDraft())} disabled={pending}>
                    <PlusIcon /> Add repository
                  </Button>
                </div>
              ))}
            </div>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </div>

          <DialogFooter>
            {projectId ? (
              <Button type="button" onClick={() => goToProject(projectId)} disabled={rows.some((r) => r.status === "adding")}>Go to project</Button>
            ) : (
              <Button type="submit" disabled={!canCreate || !!draft}>
                {pending && <Loader2Icon className="animate-spin" />}
                {pending ? "Creating…" : "Create project"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
