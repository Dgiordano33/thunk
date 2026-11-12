import 'server-only';
import path from 'node:path';
import { getProject } from '@/lib/supabase/repo/projects';
import { projectBoardsDir } from '@/lib/projects/paths';
import { HttpError } from '@/lib/api/errors';
import { addCard, atomic, lock } from './store';
export async function boardFor(id: string) { const project = await getProject(id); if (!project)
    throw new HttpError(404, 'Project not found'); return { project, dir: projectBoardsDir(project.dataKey) }; }
export async function addImageCard(dir: string, input: {
    bytes: Buffer;
    mime: string;
    origin: 'user' | 'generated';
    prompt?: string;
    source?: string;
}) {
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[input.mime];
    if (!ext || !input.bytes.length || input.bytes.length > 5000000)
        throw new HttpError(400, 'Upload a PNG, JPEG, GIF or WebP up to 5 MB');
    return lock(dir, async () => { const asset = `${crypto.randomUUID()}.${ext}`; await atomic(path.join(dir, 'assets', asset), input.bytes); return addCard(dir, { kind: 'image', asset, mime: input.mime, title: input.prompt?.slice(0, 200) || 'Image', author: input.origin === 'user' ? 'user' : 'agent' }, input.source); });
}
