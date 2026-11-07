import { GitBranchIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MemoryEditor } from "@/components/memory/memory-editor";
import { relativeTime } from "@/components/session/labels";
import { Badge } from "@/components/ui/badge";
import { NewSessionForm } from "@/components/workspace/new-session-form";
import { WorkspaceActions } from "@/components/workspace/workspace-actions";
import { listSessions } from "@/lib/agent";
import { env } from "@/lib/env";
import { getWorkspaceContext } from "@/lib/projects";
import { worktreeStatus } from "@/lib/projects/git";

export const dynamic = "force-dynamic";

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

export async function generateMetadata({ params }: PageProps<"/w/[id]">) {
  const { id } = await params;
  const ctx = await getWorkspaceContext(id).catch(() => null);
  return { title: ctx ? `${ctx.workspace.name} · ${ctx.project.name} · Thunk` : "Thunk" };
}

export default async function WorkspacePage({ params }: PageProps<"/w/[id]">) {
  const { id } = await params;
  const ctx = await getWorkspaceContext(id);
  if (!ctx) notFound();
  const { project, workspace } = ctx;
  const [sessions, git] = await Promise.all([listSessions({ workspaceId: id, limit: 50 }), worktreeStatus(workspace.cwd)]);
  const archived = workspace.status === "archived";

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 py-12">
      <header>
        <nav className="text-muted-foreground flex items-center gap-1 text-xs">
          <Link href="/" className="hover:underline">
            Projects
          </Link>
          <span>/</span>
          <Link href={`/p/${project.id}`} className="hover:underline">
            {project.name}
          </Link>
        </nav>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          {archived && (
            <Badge variant="secondary" className="h-5 text-[11px]">
              Archived
            </Badge>
          )}
          <div className="ml-auto">
            <WorkspaceActions workspace={workspace} />
          </div>
        </div>
        <p className="text-muted-foreground mt-1 font-mono text-xs">{home(workspace.cwd)}</p>
        {git && (
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="h-5 gap-1 font-mono text-[11px]">
              <GitBranchIcon className="size-3" />
              {git.branch ?? "detached"}
            </Badge>
            {workspace.worktreePath ? <span>worktree · from {workspace.baseRef}</span> : <span>main checkout</span>}
            <span>·</span>
            <span>{git.dirty === 0 ? "clean" : `${git.dirty} changed`}</span>
            {git.ahead !== null && (git.ahead > 0 || (git.behind ?? 0) > 0) && (
              <span>
                · {git.ahead} ahead{git.behind ? `, ${git.behind} behind` : ""}
              </span>
            )}
            {git.lastCommit && <span className="truncate">· {git.lastCommit}</span>}
          </div>
        )}
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium">New session</h2>
        {archived ? (
          <p className="text-muted-foreground text-sm">Unarchive the workspace to start sessions.</p>
        ) : (
          <NewSessionForm workspaceId={workspace.id} defaultModel={env.DEFAULT_MODEL} />
        )}
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No sessions yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/s/${s.id}`} className="hover:bg-muted block rounded-md px-3 py-2 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`size-1.5 shrink-0 rounded-full ${s.live ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                    <span className="truncate text-sm font-medium">{s.title || "Untitled session"}</span>
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs">{relativeTime(s.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MemoryEditor
        scope="workspaces"
        id={workspace.id}
        title="Workspace memory"
        hint="Shared by every session in this workspace (it is their auto-memory directory): the task, progress, decisions, what's next."
      />
    </main>
  );
}
