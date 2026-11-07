import { ArchiveIcon, FolderGitIcon, FolderIcon, GitBranchIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MemoryEditor } from "@/components/memory/memory-editor";
import { ExternalSessions } from "@/components/project/external-sessions";
import { NewWorkspaceForm } from "@/components/project/new-workspace-form";
import { relativeTime } from "@/components/session/labels";
import { Badge } from "@/components/ui/badge";
import { listSessions } from "@/lib/agent";
import { ensureMainWorkspace, listExternalSessions } from "@/lib/projects";
import { getProject } from "@/lib/supabase/repo/projects";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

export async function generateMetadata({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const project = await getProject(id).catch(() => null);
  return { title: project ? `${project.name} · Thunk` : "Thunk" };
}

export default async function ProjectPage({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  await ensureMainWorkspace(project);
  const [workspaces, owned] = await Promise.all([listWorkspaces(id), listSessions({ projectId: id, limit: 500 })]);
  const externalSessions = await listExternalSessions(project, { exclude: owned.map((s) => s.sdkSessionId) });
  const active = workspaces.filter((w) => w.status === "active");
  const archived = workspaces.filter((w) => w.status === "archived");

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 py-12">
      <header>
        <Link href="/" className="text-muted-foreground text-xs hover:underline">
          ← Projects
        </Link>
        <div className="mt-2 flex items-center gap-2">
          {project.kind === "repo" ? <FolderGitIcon className="size-5" /> : <FolderIcon className="size-5" />}
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <Badge variant="secondary" className="h-5 text-[11px]">
            {project.kind}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 font-mono text-xs">{home(project.root)}</p>
        {project.remote && (
          <p className="text-muted-foreground mt-0.5 font-mono text-xs">
            {project.remote}
            {project.defaultBranch && ` · ${project.defaultBranch}`}
          </p>
        )}
      </header>

      <section>
        <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">Workspaces</h2>
        <ul className="flex flex-col gap-1">
          {active.map((w) => (
            <li key={w.id}>
              <Link href={`/w/${w.id}`} className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{w.name}</span>
                    {w.worktreePath ? (
                      <Badge variant="outline" className="h-4 gap-1 font-mono text-[10px]">
                        <GitBranchIcon className="size-3" />
                        {w.branch}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-4 text-[10px]">
                        in place
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate font-mono text-xs">{home(w.cwd)}</p>
                </div>
                <div className="text-muted-foreground shrink-0 text-right text-xs">
                  <div>
                    {w.sessionCount} session{w.sessionCount === 1 ? "" : "s"}
                  </div>
                  <div>{relativeTime(w.lastSessionAt ?? w.updatedAt)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {archived.length > 0 && (
          <details className="mt-2">
            <summary className="text-muted-foreground cursor-pointer text-xs">
              <ArchiveIcon className="mr-1 inline size-3" />
              {archived.length} archived
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {archived.map((w) => (
                <li key={w.id}>
                  <Link href={`/w/${w.id}`} className="text-muted-foreground hover:bg-muted block rounded-md px-3 py-1.5 text-sm">
                    {w.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium">New workspace</h2>
        <NewWorkspaceForm project={project} />
      </section>

      <MemoryEditor
        scope="projects"
        id={project.id}
        title="Project memory"
        hint="Durable facts about the whole repo or folder. Every session in every workspace sees this in its system prompt and can edit it."
      />

      <ExternalSessions sessions={externalSessions} workspaces={workspaces} />
    </main>
  );
}
