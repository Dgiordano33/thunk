'use client';
import { flattenChart, flattenDrawing, flattenImage } from "@/lib/board/flatten.client";
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PencilIcon, TypeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NeedsYouTray } from './needs-you-tray';
import { BoardSurface, useFocusIds, useOutline, type Tool } from './board-surface';
import { useBoardPrimitive, useView, type BoardHandle } from './use-board-primitive';
import { boardRequest, flushAll, useBoard } from '@/lib/store/board-store';
import { useBoardPersistence } from '@/lib/client/use-board-persistence';
import { useSession } from '@/lib/store/session-store';
import { connectSession } from '@/lib/client/sse';
import { getEditor } from '@/lib/editor/registry';
import { extendDrawing } from '@/lib/board/drawing';
import { OUTLINE, boxesOf, movePatches, outlineFocus, positionsOf, stackGroup, widthPatch } from '@/lib/board/interaction';
import { MAX_IMAGES, attachments, isFocus, pendingOf, visualKey, type Scope } from '@/lib/board/pending';
import type { Card, Snapshot } from '@/lib/board/types';

/** A stroke that starts this close (world px) to an existing drawing extends it instead of starting a new one. */
const DRAWING_REACH = 48;
/** New text blocks wrap at this width. */
const TEXT_WIDTH = 900;

const fail = (e: unknown) => useBoard.setState({ error: e instanceof Error ? e.message : String(e) });

/** Focus the editor for a just-created card once it has mounted. */
function focusEditor(id: string, tries = 60) {
    const editor = getEditor(id);
    if (editor) return void editor.commands.focus('end');
    if (tries > 0) requestAnimationFrame(() => focusEditor(id, tries - 1));
}

export function BoardView({ projectId, slug, name, initial }: {
    projectId: string;
    slug: string;
    name: string;
    initial: Snapshot;
}) {
    const router = useRouter();
    const cards = useBoard(s => s.cards), board = useBoard(s => s.board), error = useBoard(s => s.error);
    const base = `/api/projects/${projectId}/board`;
    const space = useRef(false);
    const focusIds = useFocusIds(), outline = useOutline(focusIds);
    const positions = useMemo(() => positionsOf(cards), [cards]), boxes = useMemo(() => boxesOf(cards, outline), [cards, outline]);
    const handle = useBoardPrimitive(initial.board.viewport, base, fail, {
        panning: () => space.current,
        positions,
        // One store write per gesture: every card that moved, with the one dragged unstacked.
        onPositionsChange: (next, { active }) => useBoard.getState().editMany(movePatches(useBoard.getState().cards, next, active)),
        group: key => stackGroup(useBoard.getState().cards, key),
        boxes,
        // A card's edge sets its width; the outline's handles redefine the focus as what sits inside.
        onBoxesChange: (next, { active }) => {
            const box = active && next[active], { cards, focus, edit, setFocus } = useBoard.getState();
            if (!box) return;
            if (active === OUTLINE) setFocus(outlineFocus(cards, focus, box));
            else edit(active, widthPatch(box.width));
        },
    });
    const [sessionId, setSessionId] = useState(initial.board.agent?.sessionId), [activity, setActivity] = useState(''), [busy, setBusy] = useState(false), [deferred, setDeferred] = useState(false);
    const [tool, setTool] = useState<Tool>('write');
    const deferredRef = useRef(false), sendRef = useRef<(scope?: Scope) => Promise<void>>(async () => { });
    useEffect(() => { useBoard.getState().init(initial); }, [initial]);
    useBoardPersistence(projectId);
    const reload = async () => { await flushAll(projectId); const state: Snapshot = await boardRequest(base); for (const c of state.cards)
        useBoard.getState().merge(c); useBoard.setState({ board: state.board }); };
    const send = async (scope?: Scope) => {
        if (busy && !scope) {
            deferredRef.current = true;
            setDeferred(true);
            return;
        }
        try {
            await flushAll(projectId);
            const state = useBoard.getState();
            const { attach } = attachments(pendingOf(state.board!, state.cards, scope).cards, scope);
            if (attach.length > MAX_IMAGES)
                throw new Error(`The focus has ${attach.length} new images or drawings; send at most ${MAX_IMAGES} at once.`);
            for (const c of attach) {
                const form = new FormData();
                form.append('file', c.kind === 'drawing' ? await flattenDrawing(c) : c.kind === 'chart' ? await flattenChart(c) : await flattenImage(c, `${base}/cards/${c.id}/file`), 'annotated.png');
                form.append('key', visualKey(c));
                await boardRequest(`${base}/cards/${c.id}/annotated`, 'PUT', form);
            }
            const result: { sessionId: string; sent: boolean; held: number } = await boardRequest(`${base}/send`, 'POST', { scope });
            setSessionId(result.sessionId);
            if (result.sent)
                setBusy(true);
            setActivity(!result.sent ? (isFocus(scope) ? 'Nothing new in the focus. Press ⌘↵ and type a question about it.' : 'Nothing to send.') : result.held ? `${result.held} more ${result.held === 1 ? 'image waits' : 'images wait'} for the next send (${MAX_IMAGES} per turn).` : '');
            await reload();
        }
        catch (e) {
            fail(e);
        }
    };
    useEffect(() => { sendRef.current = send; });
    useEffect(() => {
        if (!sessionId)
            return;
        let cancelled = false, connection: ReturnType<typeof connectSession> | undefined;
        void boardRequest(`/api/sessions/${sessionId}`).then(({ session }) => {
            if (cancelled)
                return;
            useSession.getState().hydrate({ meta: session, events: [], documents: [] });
            connection = connectSession(sessionId, { getLastSeq: () => useSession.getState().lastSeq, onState: s => { if (s === 'not_live')
                    setBusy(false); }, onEvent: e => {
                    useSession.getState().applyEvent(e);
                    if (e.type === 'board_op') {
                        useBoard.getState().merge(e.op.card);
                        void boardRequest(base).then((s: Snapshot) => useBoard.setState({ board: s.board })).catch(fail);
                    }
                    if (e.type === 'turn_complete')
                        setActivity(e.markdown);
                    if (e.type === 'error')
                        fail(e.message);
                    if (e.type === 'status') {
                        const running = ['running', 'awaiting', 'starting'].includes(e.state);
                        setBusy(running);
                        if (!running && deferredRef.current) {
                            deferredRef.current = false;
                            setDeferred(false);
                            setTimeout(() => void sendRef.current(), 0);
                        }
                    }
                } });
        }).catch(() => setBusy(false));
        return () => { cancelled = true; connection?.close(); };
    }, [sessionId, base]);

    const create = async (body: Record<string, unknown>) => { const { card } = await boardRequest(`${base}/cards`, 'POST', body); useBoard.getState().merge(card); return card as Card; };
    // A new block lives only in this tab until it gets content, so clicking around never touches the server.
    const createDoc = (p: { x: number; y: number }) => {
        const card: Card = { id: crypto.randomUUID(), rev: 0, kind: 'doc', title: 'Untitled', x: Math.round(p.x), y: Math.round(p.y - 14), width: TEXT_WIDTH, height: 28, author: 'user', markdown: '', baselineMarkdown: '', comments: [], strokes: [], sentAt: null };
        useBoard.getState().draft(card);
        useBoard.getState().anchor(card.id);
        useBoard.setState({ quiet: card.id });
        focusEditor(card.id);
    };
    const draw = (points: { x: number; y: number }[]) => {
        const start = points[0], near = useBoard.getState().cards.find(c => c.kind === 'drawing' && start.x >= c.x - DRAWING_REACH && start.x <= c.x + c.width + DRAWING_REACH && start.y >= c.y - DRAWING_REACH && start.y <= c.y + c.height + DRAWING_REACH);
        if (near) {
            useBoard.getState().edit(near.id, extendDrawing(near, points));
            useBoard.getState().anchor(near.id);
            return;
        }
        void create({ kind: 'drawing', title: 'Drawing', ...extendDrawing({ x: 0, y: 0, width: 0, height: 0, strokes: [] }, points) }).then(card => useBoard.getState().anchor(card.id)).catch(fail);
    };
    const upload = async (files: FileList | File[], at: { x: number; y: number }) => { try {
        let i = 0;
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/'))
                continue;
            const form = new FormData();
            form.append('file', file);
            form.append('x', String(Math.round(at.x + i * 24)));
            form.append('y', String(Math.round(at.y + i * 24)));
            i++;
            const { card } = await boardRequest(`${base}/cards`, 'POST', form);
            useBoard.getState().merge(card);
            useBoard.getState().anchor(card.id);
        }
    }
    catch (e) {
        fail(e);
    } };
    const removing = useRef(new Set<string>());
    const remove = (c: Card) => {
        if (useBoard.getState().drafts[c.id]) return useBoard.getState().discard(c.id);
        if (removing.current.has(c.id)) return;
        removing.current.add(c.id);
        void (async () => {
            await flushAll(projectId);
            const latest = useBoard.getState().cards.find(x => x.id === c.id);
            if (!latest) return;
            await boardRequest(`${base}/cards/${c.id}`, 'DELETE', { baseRev: latest.rev });
            useBoard.getState().discard(c.id);
            await reload();
        })().catch(fail).finally(() => removing.current.delete(c.id));
    };
    const revert = async (c: Card, keep: boolean) => { try {
        await flushAll(projectId);
        const latest = useBoard.getState().cards.find(x => x.id === c.id)!;
        const d = await boardRequest(`${base}/cards/${c.id}/revert`, 'POST', { baseRev: latest.rev, keep });
        useBoard.getState().merge(d.card);
    }
    catch (e) {
        fail(e);
    } };
    const center = () => { const v = handle.api.viewport.visible(); return { x: (v.left + v.right) / 2, y: v.top + (v.bottom - v.top) / 3 }; };
    const count = board ? pendingOf(board, cards).cards.length + board.tombstones.length : 0;
    const focused = focusIds.length > 0;
    const quiet = useBoard(s => s.quiet !== null && s.quiet === s.focus.anchorId);
    const later = deferred || busy;

    return <div className="relative flex h-full flex-col">
    <header className="z-20 flex items-center gap-3 border-b bg-background p-3"><Button variant="ghost" onClick={() => void flushAll(projectId).then(() => router.push(`/${slug}`)).catch(fail)}>← {name}</Button><h1 className="font-semibold">Canvas</h1>
      <div role="radiogroup" aria-label="Tool" className="flex gap-0.5 rounded-md border p-0.5">
        <Button size="sm" role="radio" aria-checked={tool === 'write'} variant={tool === 'write' ? 'secondary' : 'ghost'} onClick={() => setTool('write')} title="Write: click anywhere to type"><TypeIcon/>Write</Button>
        <Button size="sm" role="radio" aria-checked={tool === 'draw'} variant={tool === 'draw' ? 'secondary' : 'ghost'} onClick={() => setTool('draw')} title="Draw (D); Esc to stop"><PencilIcon/>Draw <kbd className="text-[10px] text-muted-foreground">D</kbd></Button>
      </div>
      <Button size="sm" variant="outline" onClick={() => createDoc(center())}>Add text</Button>
      <label className="cursor-pointer text-sm">Add image<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={e => { if (e.target.files)
        void upload(e.target.files, center()); e.target.value = ''; }}/></label><Button size="sm" variant="outline" onClick={() => handle.api.viewport.setViewport({ x: 0, y: 0, zoom: 1 })}>Reset view</Button><ZoomLabel board={handle}/></header>
    {error && <div role="alert" className="z-30 bg-destructive/10 p-3 text-sm">{error} <Button size="xs" onClick={() => useBoard.setState({ error: null })}>Dismiss</Button></div>}
    <BoardSurface base={base} board={handle} space={space} tool={tool} setTool={setTool} onCreateDoc={createDoc} onDraw={draw} onUpload={(files, at) => void upload(files, at)} onRemove={remove} onSend={scope => void sendRef.current(scope)} onRevert={revert}/>
    <footer className="z-20 flex items-center gap-3 border-t bg-background p-3"><p className="flex-1 truncate text-xs" aria-live="polite">{activity || 'Click anywhere to write, drop an image, or press D to draw. Drag the background to pan; pinch to zoom.'}</p><span className="text-sm">{focused && !quiet ? `${focusIds.length} in focus · ` : ''}{count} pending</span>{focused && <Button onClick={() => void send({ focus: focusIds })}>Send focus</Button>}<Button variant={focused ? 'outline' : 'default'} onClick={() => void send()} disabled={!count} title="Send every pending edit, comment and deletion on the canvas">{later ? 'Send all after this turn' : 'Send all'} <kbd className="text-[10px] opacity-70">{focused ? '⇧⌘↵' : '⌘↵'}</kbd></Button></footer>
    {sessionId && <NeedsYouTray />}
  </div>;
}

/** The zoom as a percentage; re-renders on its own as the view changes. */
function ZoomLabel({ board }: { board: BoardHandle }) {
    return <span className="text-xs text-muted-foreground tabular-nums">{Math.round(useView(board).zoom * 100)}%</span>;
}
