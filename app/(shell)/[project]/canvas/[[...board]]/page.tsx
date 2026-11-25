import { DesktopOnly } from "@/components/mobile/desktop-only";
import { notFound, redirect } from 'next/navigation';
import { getProjectBySlug } from '@/lib/db/repo/projects';
import { boardFor, listCanvases } from '@/lib/board/service';
import { boardModel } from '@/lib/board/model';
import { lock, snapshot } from '@/lib/board/store';
import { BoardView } from '@/components/board/board-view';
import { resolveCanvasUrl } from '@/lib/routes';
import { ensureMainWorkspace } from '@/lib/projects';
export const dynamic = 'force-dynamic';
const one = (v: string | string[] | undefined) => typeof v === 'string' ? v : undefined;
export async function generateMetadata({ params }: PageProps<'/[project]/canvas/[[...board]]'>) {
    const { project: slug, board } = await params;
    const project = await getProjectBySlug(slug).catch(() => null);
    if (!project) return { title: 'Thunk' };
    const name = (await listCanvases(project.dataKey).catch(() => [])).find(s => s.id === (board?.[0] ?? 'main'))?.name ?? 'Canvas';
    return { title: `${name} · ${project.name} · Thunk` };
}
export default async function CanvasPage({ params, searchParams }: PageProps<'/[project]/canvas/[[...board]]'>) {
    const { project: slug, board: segments } = await params;
    const project = await getProjectBySlug(slug);
    if (!project) notFound();
    const query = await searchParams;
    const resolved = resolveCanvasUrl(project, segments, one(query.session), one(query.card));
    if (!resolved) notFound();
    if ('redirect' in resolved) redirect(resolved.redirect);
    const { boardId } = resolved;
    const sessions = await listCanvases(project.dataKey);
    if (!sessions.some(s => s.id === boardId)) notFound();
    const { dir } = await boardFor(project.id, boardId);
    const [initial, main] = await Promise.all([lock(dir, () => snapshot(dir)), ensureMainWorkspace(project)]);
    // The board owns its scroll and gestures, so it fills the pane instead of scrolling inside it.
    return <div className="sky-surface h-full overflow-hidden bg-background text-foreground">
      <DesktopOnly href={`/${project.slug}`}><BoardView key={`${project.id}:${boardId}`} sessions={sessions} boardId={boardId} projectId={project.id} slug={project.slug} model={boardModel(initial.board)} mainWorkspace={main.slug} focusCard={one(query.card)} initial={initial}/></DesktopOnly>
    </div>;
}
