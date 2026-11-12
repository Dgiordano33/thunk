import { notFound } from 'next/navigation';
import { getProjectBySlug } from '@/lib/supabase/repo/projects';
import { projectBoardsDir } from '@/lib/projects/paths';
import { lock, snapshot } from '@/lib/board/store';
import { BoardView } from '@/components/board/board-view';
export const dynamic = 'force-dynamic';
export default async function CanvasPage({ params }: PageProps<'/[project]/canvas'>) {
    const project = await getProjectBySlug((await params).project);
    if (!project)
        notFound();
    const dir = projectBoardsDir(project.dataKey);
    return <BoardView key={project.id} projectId={project.id} slug={project.slug} name={project.name} initial={await lock(dir, () => snapshot(dir))}/>;
}
