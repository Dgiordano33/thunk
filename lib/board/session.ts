import path from 'node:path';
import { readFile } from 'node:fs/promises';
import 'server-only';
import { startSession, resumeSession, liveMeta, subscribe, emit, pushUserMessage, closeSession, getSession, isTerminated, setState, type LiveSession } from '@/lib/agent';
import { providerOf } from '@/lib/agent/types';
import { boardModel } from './model';
import { getSessionRow } from '@/lib/db/repo/sessions';
import { ensureBoardWorkspace } from './workspace';
import { withFileLock } from '@/lib/notes/file-write';
import { boardFor } from './service';
import { addCard, assetBytes, lock, readBoard, saveBoard, saveCard, snapshot } from './store';
import { MAX_IMAGES, attachments, isFocus, openThreads, pendingOf, readingOrder, visualKey, type Scope } from './pending';
import type { Card } from './types';
import { HttpError } from '@/lib/api/errors';
import { payload } from './payload';
import type { PromptImage } from '@/lib/prompts/schema';
export async function ensureBoardSession(projectId: string, boardId = 'main') {
    return withFileLock(`board-session:${projectId}:${boardId}`, async () => {
        const { dir } = await boardFor(projectId, boardId);
        const workspace = await ensureBoardWorkspace(projectId, boardId), board = await readBoard(dir), model = boardModel(board);
        // A session from a replaced workspace starts over in the new one; the transcript is carried across.
        const previous = board.agent ? liveMeta(board.agent.sessionId) ?? await getSessionRow(board.agent.sessionId) : null;
        let live = previous?.workspaceId === workspace.id && board.agent ? await resumeSession(board.agent.sessionId) : null, fresh = false;
        // Claude and Codex transcripts aren't interchangeable: a provider change starts the conversation over.
        if (live && providerOf(live.meta.model) !== providerOf(model)) {
            closeSession(live.id);
            live = null;
            fresh = true;
        }
        if (live && live.meta.model !== model) await applyModel(live, model);
        if (!live) {
            live = await startSession({ workspaceId: workspace.id, model, permissionMode: 'default', title: board.name ?? 'Canvas', origin: { kind: 'board', boardId }, resumeSdkSessionId: fresh ? undefined : board.agent?.sdkSessionId ?? undefined });
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
                    void lock(dir, async () => { const card = await addCard(dir, { markdown: e.markdown, baselineMarkdown: e.markdown, title: 'Response', author: 'agent', sentAt: new Date().toISOString() }); emit(session, { type: 'board_op', boardId, op: { card } }); }).catch(console.error);
            });
        }
        return session;
    });
}
/** Switches a live session's model in place. Codex can't, so it keeps its model until the session next starts. */
async function applyModel(live: LiveSession, model: string) {
    if (providerOf(model) === 'codex') return;
    await live.driver.setModel(model);
    live.meta.model = model;
    setState(live, live.meta.status);
}
/**
 * Applies a model change to a board's live agent, when it has one. A different provider can't continue the
 * same transcript, so that closes the session and forgets it; the next send starts a new one.
 */
export async function changeBoardModel(dir: string) {
    await lock(dir, async () => {
        const board = await readBoard(dir), live = board.agent ? getSession(board.agent.sessionId) : undefined, model = boardModel(board);
        // A session that isn't running picks the model up when the next send resumes it.
        if (!live || isTerminated(live) || live.meta.model === model) return;
        if (providerOf(model) === providerOf(live.meta.model)) return applyModel(live, model);
        closeSession(live.id);
        board.agent = null;
        await saveBoard(dir, board);
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
export async function sendBoard(projectId: string, scope?: Scope, boardId = 'main') {
    const live = await ensureBoardSession(projectId, boardId), { dir } = await boardFor(projectId, boardId);
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
