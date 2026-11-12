import path from 'node:path';
import { readFile } from 'node:fs/promises';
import 'server-only';
import { startSession, resumeSession, subscribe, emit, pushUserMessage } from '@/lib/agent';
import { ensureMainWorkspace } from '@/lib/projects';
import { withFileLock } from '@/lib/notes/file-write';
import { boardFor } from './service';
import { addCard, assetBytes, lock, readBoard, saveBoard, saveCard, snapshot } from './store';
import { pendingOf, type Scope } from './pending';
import { payload } from './payload';
import type { PromptImage } from '@/lib/prompts/schema';
export async function ensureBoardSession(projectId: string) {
    return withFileLock(`board-session:${projectId}`, async () => {
        const { project, dir } = await boardFor(projectId), board = await readBoard(dir);
        let live = board.agent ? await resumeSession(board.agent.sessionId) : null;
        if (!live) {
            const workspace = await ensureMainWorkspace(project);
            live = await startSession({ workspaceId: workspace.id, model: 'claude-sonnet-5-5', permissionMode: 'default', title: 'Canvas', origin: { kind: 'board' }, resumeSdkSessionId: board.agent?.sdkSessionId ?? undefined });
        }
        const session = live;
        await lock(dir, async () => { const b = await readBoard(dir); b.agent = { sessionId: session.id, sdkSessionId: session.meta.sdkSessionId ?? board.agent?.sdkSessionId ?? null }; await saveBoard(dir, b); });
        if (!watched.has(session)) {
            watched.add(session);
            let hadOp = false;
            subscribe(session, e => {
                if ((e.type === 'user_message' && !e.queued) || e.type === 'message_dequeued')
                    hadOp = false;
                if (e.type === 'board_op')
                    hadOp = true;
                if (e.type === 'init')
                    void lock(dir, async () => { const b = await readBoard(dir); b.agent = { sessionId: session.id, sdkSessionId: e.sdkSessionId }; await saveBoard(dir, b); }).catch(console.error);
                if (e.type === 'turn_complete' && !hadOp && e.markdown.length > 280)
                    void lock(dir, async () => { const card = await addCard(dir, { markdown: e.markdown, baselineMarkdown: e.markdown, title: 'Response', author: 'agent', sentAt: new Date().toISOString() }); emit(session, { type: 'board_op', boardId: 'main', op: { card } }); }).catch(console.error);
            });
        }
        return session;
    });
}
const watched = new WeakSet<object>();
export async function sendBoard(projectId: string, scope?: Scope) {
    const live = await ensureBoardSession(projectId), { dir } = await boardFor(projectId);
    return lock(dir, async () => {
        const state = await snapshot(dir), pending = pendingOf(state.board, state.cards, scope);
        if (!pending.cards.length && !pending.tombstones.length)
            return { sessionId: live.id };
        const images: PromptImage[] = [];
        for (const c of pending.cards.filter(c => c.kind === 'image').slice(0, 5)) {
            const annotated = await readFile(path.join(dir, 'assets', `${c.id}.annotated.rev`), 'utf8').catch(() => null);
            const isAnnotated = annotated === String(c.rev);
            const bytes = isAnnotated ? await readFile(path.join(dir, 'assets', `${c.id}.annotated.png`)) : await assetBytes(dir, c);
            const mime = isAnnotated ? 'image/png' : c.mime;
            images.push({ type: 'file', filename: c.asset, mediaType: mime as PromptImage['mediaType'], url: `data:${mime};base64,${bytes.toString('base64')}` });
        }
        pushUserMessage(live, payload(state, scope) + `\nImage directory: ${path.join(dir, "assets")}`, { images });
        const now = new Date().toISOString();
        for (const c of pending.cards) {
            if (!scope) {
                c.baselineMarkdown = c.markdown;
                c.sentAt = now;
                c.strokes.forEach(s => s.sentAt ??= now);
            }
            for (const t of c.comments)
                if (!scope || t.id === scope.targetId) {
                    t.sentAt ??= now;
                    t.replies.forEach(r => r.sentAt ??= now);
                }
            await saveCard(dir, c);
        }
        state.board.lastSend = now;
        if (!scope)
            state.board.tombstones = [];
        await saveBoard(dir, state.board);
        return { sessionId: live.id };
    });
}
