import { DesktopOnly } from "@/components/mobile/desktop-only";
import { notFound } from 'next/navigation';
import { getProjectBySlug } from '@/lib/supabase/repo/projects';
import { boardFor, listCanvases } from '@/lib/board/service';
import { lock, snapshot } from '@/lib/board/store';
import { BoardView } from '@/components/board/board-view';
export const dynamic = 'force-dynamic';
export default async function CanvasPage({ params, searchParams }: PageProps<'/[project]/canvas'>) {
    const project = await getProjectBySlug((await params).project);
    if (!project)
        notFound();
    const selected = (await searchParams).session;
    if (selected !== undefined && typeof selected !== 'string') notFound();
    const boardId = selected ?? 'main';
    const sessions = await listCanvases(project.dataKey);
    if (!sessions.some(s => s.id === boardId)) notFound();
    const { dir } = await boardFor(project.id, boardId);
    return <DesktopOnly href={`/${project.slug}`}><BoardView key={`${project.id}:${boardId}`} sessions={sessions} boardId={boardId} projectId={project.id} slug={project.slug} name={project.name} initial={await lock(dir, () => snapshot(dir))}/></DesktopOnly>;
}
