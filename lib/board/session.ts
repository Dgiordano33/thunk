import path from 'node:path';
import { readFile } from 'node:fs/promises';
import 'server-only';
import { startSession, resumeSession, subscribe, emit, pushUserMessage } from '@/lib/agent';
import { ensureMainWorkspace } from '@/lib/projects';
import { withFileLock } from '@/lib/notes/file-write';
import { boardFor } from './service';
import { addCard, assetBytes, lock, readBoard, saveBoard, saveCard, snapshot } from './store';
import { MAX_IMAGES, attachments, isFocus, openThreads, pendingOf, readingOrder, visualKey, type Scope } from './pending';
import type { Card } from './types';
import { HttpError } from '@/lib/api/errors';
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
// Pinned to globalThis so a dev hot reload does not attach a second listener (which duplicated fallback cards).
const watched: WeakSet<object> = ((globalThis as { __thunkBoardWatched?: WeakSet<object> }).__thunkBoardWatched ??= new WeakSet());
const ATTACHABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** The image the agent sees for a visual card: the flattened upload when it matches the card, else the raw asset if the model accepts it. */
async function imageFor(dir: string, c: Card): Promise<PromptImage> {
    const key = await readFile(path.join(dir, 'assets', `${c.id}.annotated.key`), 'utf8').catch(() => null);
    const annotated = key === visualKey(c), marked = c.strokes.length > 0 || c.comments.some(t => t.x !== undefined);
    if (!annotated && (c.kind === 'drawing' || marked || !ATTACHABLE.has(c.mime ?? '')))
        throw new HttpError(409, `${c.kind === 'drawing' ? 'A drawing' : 'An image'} changed while sending. Send again.`);
    const bytes = annotated ? await readFile(path.join(dir, 'assets', `${c.id}.annotated.png`)) : await assetBytes(dir, c);
    const mime = (annotated ? 'image/png' : c.mime) as PromptImage['mediaType'];
    return { type: 'file', filename: c.asset ?? `${c.id}.png`, mediaType: mime, url: `data:${mime};base64,${bytes.toString('base64')}` };
}
/**
 * Sends the scope's pending work to the board agent. `sent` is false when there was nothing new to send;
 * `held` counts images left pending for the next send because of the per-turn cap.
 */
export async function sendBoard(projectId: string, scope?: Scope) {
    const live = await ensureBoardSession(projectId), { dir } = await boardFor(projectId);
    return lock(dir, async () => {
        const state = await snapshot(dir), pending = pendingOf(state.board, state.cards, scope), focus = isFocus(scope);
        const idle = { sessionId: live.id, sent: false, held: 0 };
        const text = focus ? scope.prompt?.trim() : undefined, group = [...pending.cards, ...pending.seen].sort(readingOrder);
        if (focus && (text ? !group.length : pending.cards.every(c => c.kind === 'doc' && !c.markdown.trim() && !openThreads(c))))
            return idle;
        const { attach, held } = attachments(pending.cards, scope);
        if (attach.length > MAX_IMAGES)
            throw new HttpError(400, `Focus has ${attach.length} new images or drawings; send at most ${MAX_IMAGES} at once.`);
        const heldIds = new Set(held.map(c => c.id)), cards = pending.cards.filter(c => !heldIds.has(c.id));
        if (!cards.length && !pending.tombstones.length && !text)
            return idle;
        const images: PromptImage[] = [];
        for (const c of attach)
            images.push(await imageFor(dir, c));
        const now = new Date().toISOString();
        // The instruction stays on the canvas as a chip under the group; the reply chains below it.
        let ask: { text: string; cardId: string } | undefined;
        if (text) {
            const chip = await addCard(dir, { markdown: text, baselineMarkdown: text, prompt: true, title: 'Prompt', width: 480, height: 36, sentAt: now }, group.at(-1)!.id, 'below');
            ask = { text, cardId: chip.id };
            state.board = await readBoard(dir);
        }
        pushUserMessage(live, payload(state, scope, { ...pending, cards }, ask) + `\nImage directory: ${path.join(dir, "assets")}`, { images });
        for (const c of cards) {
            if (!scope || focus) {
                c.baselineMarkdown = c.markdown;
                delete c.baselineChart;
                c.sentAt = now;
                c.strokes.forEach(s => s.sentAt ??= now);
            }
            for (const t of c.comments)
                if (!scope || focus || t.id === scope.targetId) {
                    t.sentAt ??= now;
                    t.replies.forEach(r => r.sentAt ??= now);
                }
            await saveCard(dir, c);
        }
        state.board.lastSend = now;
        if (!scope)
            state.board.tombstones = [];
        await saveBoard(dir, state.board);
        return { sessionId: live.id, sent: true, held: held.length };
    });
}
