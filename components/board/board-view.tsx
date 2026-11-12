'use client';
import { flattenImage } from "@/lib/board/flatten.client";
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { Button } from '@/components/ui/button';
import { Composer } from '@/components/comments/composer';
import { DiffView } from '@/components/canvas/diff-view';
import { BoardDocEditor } from './board-doc-editor';
import { NeedsYouTray } from './needs-you-tray';
import { boardRequest, flushAll, useBoard } from '@/lib/store/board-store';
import { useBoardPersistence } from '@/lib/client/use-board-persistence';
import { useSession } from '@/lib/store/session-store';
import { connectSession } from '@/lib/client/sse';
import { pendingOf, type Scope } from '@/lib/board/pending';
import type { Card, Snapshot } from '@/lib/board/types';
export function BoardView({ projectId, slug, name, initial }: {
    projectId: string;
    slug: string;
    name: string;
    initial: Snapshot;
}) {
    const router = useRouter();
    const cards = useBoard(s => s.cards), board = useBoard(s => s.board), error = useBoard(s => s.error);
    const [view, setView] = useState(initial.board.viewport), [sessionId, setSessionId] = useState(initial.board.agent?.sessionId), [activity, setActivity] = useState(''), [busy, setBusy] = useState(false), [deferred, setDeferred] = useState(false);
    const [thread, setThread] = useState<{
        cardId: string;
        quote: string;
        id?: string;
        x?: number;
        y?: number;
    } | null>(null), [review, setReview] = useState<string | null>(null), [tool, setTool] = useState<'pin' | 'draw'>('pin');
    const [size, setSize] = useState({ width: 1800, height: 1000 });
    const deferredRef = useRef(false), sendRef = useRef<(scope?: Scope) => Promise<void>>(async () => { }), space = useRef(false), viewport = useRef<HTMLDivElement>(null);
    const drag = useRef<{
        x: number;
        y: number;
        ox: number;
        oy: number;
        id?: string;
        resize?: boolean;
    } | null>(null);
    const drawing = useRef<{
        id: string;
        points: {
            x: number;
            y: number;
        }[];
    } | null>(null);
    const base = `/api/projects/${projectId}/board`;
    useEffect(() => { useBoard.getState().init(initial); }, [initial]);
    useBoardPersistence(projectId);
    useEffect(() => {
        const el = viewport.current; if (!el) return;
        const wheel = (e: WheelEvent) => {
            if ((e.target as HTMLElement).closest('[data-card]') && !e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const r = el.getBoundingClientRect(), x = e.clientX-r.left, y = e.clientY-r.top;
                setView(v => { const zoom = Math.max(.2,Math.min(2,v.zoom*Math.exp(-e.deltaY*.01))); return {zoom,x:x-(x-v.x)*zoom/v.zoom,y:y-(y-v.y)*zoom/v.zoom}; });
            } else setView(v => ({...v,x:v.x-e.deltaX,y:v.y-e.deltaY}));
        };
        el.addEventListener('wheel',wheel,{passive:false});
        return () => el.removeEventListener('wheel',wheel);
    }, []);

    useEffect(() => { const el = viewport.current; if (!el)
        return; const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight })); observer.observe(el); return () => observer.disconnect(); }, []);
    const fail = (e: unknown) => useBoard.setState({ error: e instanceof Error ? e.message : String(e) });
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
            for (const c of pendingOf(state.board!, state.cards, scope).cards.filter(c => c.kind === 'image')) {
                const form = new FormData();
                form.append('file', await flattenImage(c, `${base}/cards/${c.id}/file`), 'annotated.png');
                form.append('baseRev', String(c.rev));
                await boardRequest(`${base}/cards/${c.id}/annotated`, 'PUT', form);
            }
            const result = await boardRequest(`${base}/send`, 'POST', { scope });
            setSessionId(result.sessionId);
            setBusy(true);
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
    useEffect(() => {
        const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).isContentEditable) {
            space.current = true;
            e.preventDefault();
        } if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void sendRef.current();
        } };
        const up = () => { space.current = false; };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up); };
    }, []);
    useEffect(() => { const t = setTimeout(() => { void boardRequest(base, 'PATCH', { viewport: view }).catch(fail); }, 500); return () => clearTimeout(t); }, [view, base]);
    const upload = async (files: FileList | File[]) => { try {
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/'))
                continue;
            const form = new FormData();
            form.append('file', file);
            const { card } = await boardRequest(`${base}/cards`, 'POST', form);
            useBoard.getState().merge(card);
        }
    }
    catch (e) {
        fail(e);
    } };
    const addComment = (body: string) => { if (!thread)
        return; const c = useBoard.getState().cards.find(c => c.id === thread.cardId)!; const id = thread.id ?? crypto.randomUUID(); useBoard.getState().edit(c.id, { comments: [...c.comments, { id, body, quote: thread.quote, x: thread.x, y: thread.y, author: 'user', sentAt: null, resolved: false, replies: [] }] }); setThread(null); if (body.includes('@agent'))
        void send({ cardId: c.id, targetId: id }); };
    const edit = (c: Card, p: Partial<Card>) => useBoard.getState().edit(c.id, p);
    const point = (e: React.PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    const count = board ? pendingOf(board, cards).cards.length + board.tombstones.length : 0;
    return <div className="relative flex h-full flex-col" onPaste={e => { if (e.clipboardData.files.length) {
        e.preventDefault();
        void upload(e.clipboardData.files);
    } }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files); }}>
    <header className="z-20 flex items-center gap-3 border-b bg-background p-3"><Button variant="ghost" onClick={() => void flushAll(projectId).then(() => router.push(`/${slug}`)).catch(fail)}>← {name}</Button><h1 className="font-semibold">Canvas</h1><Button size="sm" onClick={() => void boardRequest(`${base}/cards`, 'POST', {}).then(d => useBoard.getState().merge(d.card)).catch(fail)}>Add document</Button><label className="cursor-pointer text-sm">Add image<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={e => { if (e.target.files)
        void upload(e.target.files); e.target.value = ''; }}/></label><Button size="sm" variant="outline" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>Reset view</Button><span className="text-xs text-muted-foreground">{Math.round(view.zoom * 100)}%</span></header>
    {error && <div role="alert" className="z-30 bg-destructive/10 p-3 text-sm">{error} <Button size="xs" onClick={() => useBoard.setState({ error: null })}>Dismiss</Button></div>}
    <div ref={viewport} className="relative flex-1 overflow-hidden bg-muted/30 touch-none" onPointerDown={e => { if (e.target === e.currentTarget || space.current) {
        drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    } }} onPointerMove={e => { const d = drag.current; if (!d)
        return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (d.id)
        useBoard.getState().edit(d.id, d.resize ? { width: Math.max(240, Math.min(2000, d.ox + dx / view.zoom)), height: Math.max(180, Math.min(3000, d.oy + dy / view.zoom)) } : { x: d.ox + dx / view.zoom, y: d.oy + dy / view.zoom });
    else
        setView(v => ({ ...v, x: d.ox + dx, y: d.oy + dy })); }} onPointerUp={() => drag.current = null} onPointerCancel={() => drag.current = null}>
      <div style={{ transform: `translate3d(${view.x}px,${view.y}px,0) scale(${view.zoom})`, transformOrigin: '0 0' }}>
        <svg className="pointer-events-none absolute overflow-visible" width="1" height="1" aria-hidden="true"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>{board?.edges.map(e => { const a = cards.find(c => c.id === e.source), b = cards.find(c => c.id === e.target); return a && b ? <line key={`${e.source}-${e.target}`} x1={a.x + a.width} y1={a.y + 40} x2={b.x} y2={b.y + 40} stroke="currentColor" opacity=".35" markerEnd="url(#arrow)"/> : null; })}</svg>
        {cards.map(c => {
            const visible = view.zoom >= .4 && c.x * view.zoom + view.x < size.width && (c.x + c.width) * view.zoom + view.x > 0 && c.y * view.zoom + view.y < size.height && (c.y + c.height) * view.zoom + view.y > 0;
            return <article data-card key={c.id} aria-label={c.title} className="absolute flex flex-col rounded-xl border bg-background shadow-sm" style={{ left: c.x, top: c.y, width: c.width, height: c.height }}>
            <div className="flex items-center gap-2 border-b p-2"><button aria-label={`Move ${c.title}`} className="cursor-grab touch-none" onPointerDown={e => { drag.current = { id: c.id, x: e.clientX, y: e.clientY, ox: c.x, oy: c.y }; e.currentTarget.setPointerCapture(e.pointerId); }} onKeyDown={e => { const delta = e.shiftKey ? 50 : 10; if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                edit(c, { x: c.x + (e.key === 'ArrowRight' ? delta : e.key === 'ArrowLeft' ? -delta : 0), y: c.y + (e.key === 'ArrowDown' ? delta : e.key === 'ArrowUp' ? -delta : 0) });
            } }}>⠿</button><input aria-label="Card title" className="min-w-0 flex-1 bg-transparent font-medium" value={c.title} onChange={e => edit(c, { title: e.target.value })}/><Button size="xs" variant="ghost" onClick={() => void (async () => { await flushAll(projectId); const latest = useBoard.getState().cards.find(x => x.id === c.id)!; await boardRequest(`${base}/cards/${c.id}`, 'DELETE', { baseRev: latest.rev }); useBoard.setState(s => ({ cards: s.cards.filter(x => x.id !== c.id) })); await reload(); })().catch(fail)}>Delete</Button></div>
            <div className="flex-1 overflow-auto p-4 select-text">
              {c.agentEdit && <div className="mb-3 text-xs">Edited by agent <Button size="xs" variant="outline" onClick={() => setReview(review === c.id ? null : c.id)}>Review</Button>{review === c.id && <><DiffView before={c.agentEdit.markdown} after={c.markdown}/>{[true, false].map(keep => <Button key={String(keep)} size="xs" onClick={() => void (async () => { await flushAll(projectId); const latest = useBoard.getState().cards.find(x => x.id === c.id)!; const d = await boardRequest(`${base}/cards/${c.id}/revert`, 'POST', { baseRev: latest.rev, keep }); useBoard.getState().merge(d.card); setReview(null); })().catch(fail)}>{keep ? 'Keep' : 'Revert'}</Button>)}</>}</div>}
              {c.kind === 'doc' ? visible ? <BoardDocEditor card={c} onChange={p => edit(c, p)} onComment={(quote, id) => setThread({ cardId: c.id, quote, id })} onMention={(quote, id) => { const current = useBoard.getState().cards.find(x => x.id === c.id)!; edit(current, { comments: [...current.comments, { id, quote, body: quote, author: 'user', sentAt: null, resolved: false, replies: [] }] }); setTimeout(() => void sendRef.current({ cardId: c.id, targetId: id }), 0); }}/> : <Streamdown>{c.markdown}</Streamdown> : <><div className="mb-2 flex gap-2"><Button size="xs" variant={tool === 'pin' ? 'default' : 'outline'} onClick={() => setTool('pin')}>Pin</Button><Button size="xs" variant={tool === 'draw' ? 'default' : 'outline'} onClick={() => setTool('draw')}>Draw</Button></div><div className="relative">
                {/* Uploaded raster assets are served by the project-scoped file route. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <span id={`image-help-${c.id}`} className="sr-only">Click to place a pin, or press Enter to annotate the center.</span><img src={`${base}/cards/${c.id}/file`} alt={c.title} className="w-full" draggable={false}/><svg className="absolute inset-0 h-full w-full touch-none" viewBox="0 0 1 1" preserveAspectRatio="none" role="button" tabIndex={0} aria-label="Add image pin at center; press Enter" onKeyDown={e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();setThread({cardId:c.id,quote:'',x:.5,y:.5});} }} aria-describedby={`image-help-${c.id}`} onPointerDown={e => { const p = point(e); if (tool === 'pin')
                    setThread({ cardId: c.id, quote: '', ...p });
                else {
                    drawing.current = { id: c.id, points: [p] };
                    e.currentTarget.setPointerCapture(e.pointerId);
                } }} onPointerMove={e => { if (drawing.current?.id === c.id)
                    drawing.current.points.push(point(e)); }} onPointerUp={() => { if (drawing.current?.id === c.id) {
                    edit(c, { strokes: [...c.strokes, { id: crypto.randomUUID(), points: drawing.current.points, sentAt: null }] });
                    drawing.current = null;
                } }}>{c.strokes.map(s => <polyline key={s.id} points={s.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e44848" strokeWidth=".005"/>)}{c.comments.filter(t => t.x !== undefined).map((t, i) => <g key={t.id}><circle cx={t.x} cy={t.y} r=".025" fill="#e44848"/><text x={t.x} y={t.y} fontSize=".035" textAnchor="middle" dominantBaseline="central" fill="white">{i + 1}</text></g>)}</svg></div></>}
              <Button className="mt-3" size="xs" variant="outline" onClick={() => setThread({ cardId: c.id, quote: '' })}>Comment</Button>
              {thread?.cardId === c.id && <Composer autoFocus placeholder="Ask a question; @agent sends immediately" onSubmit={addComment} onCancel={() => setThread(null)}/>}
              {c.comments.map(t => <details key={t.id} open={!t.resolved} className="mt-3 rounded border p-2 text-sm"><summary>{t.resolved ? 'Resolved · ' : ''}{t.body}{t.detached ? ' (detached)' : ''}</summary>{t.quote && <blockquote className="my-2 border-l-2 pl-2 text-muted-foreground">{t.quote}</blockquote>}{t.replies.map(r => <p className="my-2" key={r.id}><b>{r.author}: </b>{r.body}</p>)}<Composer submitLabel="Reply" onSubmit={body => { edit(c, { comments: c.comments.map(x => x.id === t.id ? { ...x, replies: [...x.replies, { id: crypto.randomUUID(), body, author: 'user', sentAt: null }] } : x) }); if (body.includes('@agent'))
                void send({ cardId: c.id, targetId: t.id }); }}/><Button size="xs" variant="ghost" onClick={() => edit(c, { comments: c.comments.map(x => x.id === t.id ? { ...x, resolved: !x.resolved } : x) })}>{t.resolved ? 'Reopen' : 'Resolve'}</Button></details>)}
            </div><button aria-label={`Resize ${c.title}`} onKeyDown={e=>{if(e.key.startsWith('Arrow')){e.preventDefault();edit(c,{width:Math.max(240,Math.min(2000,c.width+(e.key==='ArrowRight'?10:e.key==='ArrowLeft'?-10:0))),height:Math.max(180,Math.min(3000,c.height+(e.key==='ArrowDown'?10:e.key==='ArrowUp'?-10:0)))});}}} className="absolute bottom-0 right-0 cursor-se-resize px-2 touch-none" onPointerDown={e => { drag.current = { id: c.id, resize: true, x: e.clientX, y: e.clientY, ox: c.width, oy: c.height }; e.currentTarget.setPointerCapture(e.pointerId); }}>◢</button>
          </article>;
        })}
      </div>
    </div>
    <footer className="z-20 flex items-center gap-3 border-t bg-background p-3"><p className="flex-1 truncate text-xs" aria-live="polite">{activity || 'Write, comment, or drop an image. Space-drag to pan; pinch to zoom.'}</p><span className="text-sm">{count} pending</span><Button onClick={() => void send()} disabled={!count}>{deferred ? 'Send after this turn' : busy ? 'Send after this turn' : 'Send ⌘↵'}</Button></footer>
    {sessionId && <NeedsYouTray />}
  </div>;
}
