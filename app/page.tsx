import { FolderGitIcon, FolderIcon } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { AddProjectForm } from "@/components/home/add-project-form";
import { relativeTime } from "@/components/session/labels";
import { Badge } from "@/components/ui/badge";
import { hasSupabase } from "@/lib/env";
import { listProjects } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

export default async function Home() {
  const projects = await listProjects().catch(() => []);

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 py-16">
      <section>
        <h1>
          <span className="sr-only">Thunk</span>
          <Logo className="h-12 w-auto" />
        </h1>
        <p className="text-muted-foreground mt-2 mb-6 max-w-lg text-sm leading-relaxed">
          Projects are repos or folders. Workspaces are tasks inside a project, each with its own worktree and shared memory.
          Sessions are the chats inside a workspace.
        </p>
        <AddProjectForm />
        {!hasSupabase && (
          <p className="text-muted-foreground mt-4 text-xs">
            Supabase isn&apos;t configured: projects and sessions live in memory and won&apos;t survive a server restart.
            Memory files still persist on disk.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">Projects</h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Folders registered with Thunk by adding a project or starting a session with a folder path.
          {hasSupabase ? " This list is saved in the configured database and persists across restarts." : " This list is kept in memory until the server restarts."}
        </p>
        {projects.length === 0 ? (
          <p className="text-muted-foreground text-sm">No projects yet. Add a repo or folder above.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/p/${p.id}`} className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors">
                  {p.kind === "repo" ? (
                    <FolderGitIcon className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                    <FolderIcon className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      {p.defaultBranch && (
                        <Badge variant="outline" className="h-4 font-mono text-[10px]">
                          {p.defaultBranch}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground truncate font-mono text-xs">{home(p.root)}</p>
                  </div>
                  <div className="text-muted-foreground shrink-0 text-right text-xs">
                    <div>
                      {p.workspaceCount} workspace{p.workspaceCount === 1 ? "" : "s"}
                    </div>
                    {p.lastActivityAt && <div>{relativeTime(p.lastActivityAt)}</div>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
