import Link from "next/link";
import { NewSessionForm } from "@/components/home/new-session-form";
import { relativeTime } from "@/components/session/labels";
import { listSessions } from "@/lib/agent";
import { env, hasSupabase } from "@/lib/env";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { cwd } = await searchParams;
  const [workspaces, sessions] = await Promise.all([
    listWorkspaces().catch(() => []),
    listSessions({ limit: 12 }),
  ]);

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-10 px-6 py-16 md:flex-row">
      <section className="flex-1">
        <h1 className="text-3xl font-semibold tracking-tight">Thunk</h1>
        <p className="text-muted-foreground mt-2 mb-8 max-w-md text-sm leading-relaxed">
          Claude Code where every response is a document. Edit it, comment on it, send your revisions back.
        </p>
        <NewSessionForm
          defaultCwd={typeof cwd === "string" ? cwd : (workspaces[0]?.cwd ?? "")}
          defaultModel={env.DEFAULT_MODEL}
          recentCwds={workspaces.map((w) => w.cwd)}
        />
        {!hasSupabase && (
          <p className="text-muted-foreground mt-6 text-xs">
            Supabase isn&apos;t configured: sessions live in memory and won&apos;t survive a server restart.
          </p>
        )}
      </section>

      <aside className="w-full md:w-80">
        <h2 className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">Recent sessions</h2>
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
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex justify-between gap-2 pl-3.5 text-xs">
                    <span className="truncate font-mono">{s.cwd.split("/").slice(-2).join("/")}</span>
                    <span className="shrink-0">{relativeTime(s.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </main>
  );
}
