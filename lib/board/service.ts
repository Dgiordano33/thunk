import 'server-only';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { CanvasSession } from './types';
import { getProject } from '@/lib/supabase/repo/projects';
import { projectBoardsDir } from '@/lib/projects/paths';
import { HttpError } from '@/lib/api/errors';
import { addCard, atomic, lock, readBoard, saveBoard, validId } from './store';
export async function boardFor(id: string, boardId = 'main') {
    if (!validId(boardId)) throw new HttpError(400, 'Invalid canvas session id');
    const project = await getProject(id);
    if (!project) throw new HttpError(404, 'Project not found');
    const dir = projectBoardsDir(project.dataKey, boardId);
    if (boardId !== 'main') {
        await readFile(path.join(dir, 'board.json')).catch((e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') throw new HttpError(404, 'Canvas session not found');
            throw e;
        });
    }
    return { project, dir };
}
export async function listCanvases(key: string): Promise<CanvasSession[]> {
    const root = path.dirname(projectBoardsDir(key));
    const entries = await readdir(root, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return [];
        throw e;
    });
    const sessions: CanvasSession[] = [{ id: 'main', name: 'Canvas' }];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || !validId(entry.name)) continue;
        const board = await readBoard(path.join(root, entry.name));
        if (entry.name === 'main') sessions[0].name = board.name ?? 'Canvas';
        else sessions.push({ id: entry.name, name: board.name ?? 'Untitled canvas' });
    }
    return sessions;
}
export async function createCanvas(key: string, name: string): Promise<CanvasSession> {
    const id = crypto.randomUUID(), dir = projectBoardsDir(key, id);
    const board = await readBoard(dir);
    board.name = name;
    await saveBoard(dir, board);
    return { id, name };
}
/** Height / width of an image, read from its header where that is cheap; null when unknown. */
export function imageAspect(bytes: Buffer, mime: string): number | null {
    const ratio = (w: number, h: number) => w > 0 && h > 0 ? h / w : null;
    if (mime === 'image/png' && bytes.length >= 24)
        return ratio(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    if (mime === 'image/gif' && bytes.length >= 10)
        return ratio(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    if (mime === 'image/svg+xml') {
        const head = bytes.subarray(0, 4000).toString('utf8'), tag = head.match(/<svg[^>]*>/i)?.[0] ?? '';
        const box = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
        if (box)
            return ratio(Number(box[1]), Number(box[2]));
        const w = tag.match(/\swidth\s*=\s*["']([\d.]+)(px)?["']/i), h = tag.match(/\sheight\s*=\s*["']([\d.]+)(px)?["']/i);
        return w && h ? ratio(Number(w[1]), Number(h[1])) : null;
    }
    return null;
}
export async function addImageCard(dir: string, input: {
    bytes: Buffer;
    mime: string;
    origin: 'user' | 'generated';
    prompt?: string;
    source?: string;
    x?: number;
    y?: number;
    width?: number;
    placement?: 'right' | 'below';
}) {
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' } as Record<string, string>)[input.mime];
    if (!ext || !input.bytes.length || input.bytes.length > 5000000)
        throw new HttpError(400, 'Provide a PNG, JPEG, GIF, WebP or SVG up to 5 MB');
    const width = input.width ?? 420, height = Math.round(width * (imageAspect(input.bytes, input.mime) ?? .75));
    return lock(dir, async () => { const asset = `${crypto.randomUUID()}.${ext}`; await atomic(path.join(dir, 'assets', asset), input.bytes); return addCard(dir, { kind: 'image', asset, mime: input.mime, title: input.prompt?.slice(0, 200) || 'Image', author: input.origin === 'user' ? 'user' : 'agent', ...(input.origin === 'generated' ? { sentAt: new Date().toISOString() } : {}), width, height, ...(input.x !== undefined && input.y !== undefined ? { x: input.x, y: input.y } : {}) }, input.source, input.placement); });
}
