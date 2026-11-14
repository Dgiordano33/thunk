'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { CornerDownRightIcon, GripVerticalIcon, RefreshCwIcon, TableIcon, MessageSquarePlusIcon, PencilIcon, MapPinIcon, Trash2Icon } from 'lucide-react';
import { Composer } from '@/components/comments/composer';
import { DiffView } from '@/components/canvas/diff-view';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/store/board-store';
import { BoardDocEditor } from './board-doc-editor';
import { BoardChart, type ChartPin } from './board-chart';
import { boardRequest } from '@/lib/store/board-store';
import { anchorRow, type ChartAnchor } from '@/lib/board/chart';
import { MENTION, mentions } from '@/lib/board/agent-mention';
import type { MentionScope } from '@/lib/board/pending';
import type { Card } from '@/lib/board/types';
import { BoardCard, BoardGrip, BoardWidthHandle } from './use-board-primitive';
import { BoardButton, BoardToggle, BoardToolbar, BoardToolbarButton, Confirm, Hint } from './board-ui';

/** Accessible name for an item: the first line of its text, falling back to the stored title. */
export const itemLabel = (c: Card) => c.kind === 'doc' ? c.markdown.split('\n').map(l => l.replace(/^[#>\-*\s\d.[\]x]+/, '').trim()).find(Boolean)?.slice(0, 80) || c.title || 'Text' : c.title || (c.kind === 'image' ? 'Image' : c.kind === 'chart' ? 'Chart' : 'Drawing');

/** Text blocks whose live editor has been measured this session. */
const measured = new Set<string>();

type Thread = { quote: string; id?: string; x?: number; y?: number; anchor?: ChartAnchor };

export const BoardItem = memo(function BoardItem({ card: c, base, visible, selected, onRemove, onMention, onRevert }: {
    card: Card;
    base: string;
    visible: boolean;
    selected: boolean;
    onRemove: (c: Card) => void;
    onMention: (scope: MentionScope) => void;
    onRevert: (c: Card, keep: boolean) => Promise<void>;
}) {
    const ref = useRef<HTMLElement>(null);
    const [thread, setThread] = useState<Thread | null>(null), [review, setReview] = useState(false), [tool, setTool] = useState<'none' | 'pin' | 'draw'>('none'), [showData, setShowData] = useState(false);
    // Refresh: `confirming` shows the command before its first run; `refreshing` covers the run itself.
    const [confirming, setConfirming] = useState(false), [refreshing, setRefreshing] = useState(false);
    const drawing = useRef<{ x: number; y: number }[] | null>(null);
    const edit = (p: Partial<Card>) => useBoard.getState().edit(c.id, p);
    const latest = () => useBoard.getState().cards.find(x => x.id === c.id) ?? c;
    const label = itemLabel(c);

    // Text and image heights follow their content; keep the stored height in sync for culling, placement, stacking and focus.
    // A text block is measured from its live editor; the static render used off-screen or zoomed out only counts until then,
    // so swapping between the two never ping-pongs saves.
    useEffect(() => {
        const el = ref.current;
        if (!el || c.kind === 'drawing') return;
        const live = c.kind !== 'doc' || visible || !!c.prompt;
        if (!live && measured.has(c.id)) return;
        const observer = new ResizeObserver(() => {
            const h = Math.round(el.offsetHeight);
            if (h <= 0) return;
            if (live) measured.add(c.id);
            if (Math.abs(h - latest().height) > 2) edit({ height: h });
        });
        observer.observe(el);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [c.id, c.kind, visible]);


    const addComment = (body: string) => {
        if (!thread) return;
        const current = latest(), id = thread.id ?? crypto.randomUUID();
        edit({ comments: [...current.comments, { id, body, quote: thread.quote, x: thread.x, y: thread.y, ...(thread.anchor ? { anchor: thread.anchor } : {}), author: 'user', sentAt: null, resolved: false, replies: [] }] });
        setThread(null);
        if (mentions(body)) onMention({ cardId: c.id, targetId: id });
    };
    const point = (e: React.PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    const editing = () => !!ref.current?.contains(document.activeElement) && (document.activeElement as HTMLElement).isContentEditable;
    const side = !!(c.agentEdit || thread || c.comments.length);
    const plotted = c.kind === 'chart' && !!c.chart && c.chart.type !== 'stat';
    const pins: ChartPin[] = c.comments.filter(t => t.anchor).map((t, i) => ({ id: t.id, anchor: t.anchor!, n: i + 1 }));
    const refresh = async () => {
        const command = latest().chartSource?.command;
        if (!command) return;
        setConfirming(false);
        setRefreshing(true);
        try {
            useBoard.getState().merge((await boardRequest(`${base}/cards/${c.id}/refresh`, 'POST', { command })).card);
        }
        catch (e) {
            useBoard.setState({ error: e instanceof Error ? e.message : String(e) });
        }
        finally {
            setRefreshing(false);
        }
    };
    const handle = 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100';

    return <BoardCard value={c.id} ref={ref} data-card data-id={c.id} aria-label={label} className={cn('group absolute select-text', c.kind !== 'doc' && 'cursor-default rounded-md', selected && 'outline-1 outline-offset-4 outline-primary/50 outline focus-within:outline-none')} style={{ left: c.x, top: c.y, width: `var(--resize-width, ${c.width}px)`, height: c.kind === 'drawing' ? c.height : undefined }}
      onPointerDownCapture={e => {
          if (e.button !== 0) return;
          if (e.shiftKey && !editing()) {
              e.preventDefault();
              e.stopPropagation();
              useBoard.getState().toggle(c.id);
          } else useBoard.getState().anchor(c.id);
      }}>
      <Hint label="Drag to move; arrows nudge" side="left"><BoardGrip value={c.id} type="button" aria-label={`Move ${label}`} className={cn('absolute -left-8 top-0.5 flex h-6 w-6 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted in-data-dragging:cursor-grabbing', handle)}><GripVerticalIcon className="size-4" aria-hidden="true"/></BoardGrip></Hint>
      <BoardToolbar aria-label={`${label} actions`} className={cn('absolute -top-8 right-0 rounded-md border bg-popover p-0.5 shadow-sm', handle)}>
        {(c.kind === 'image' || plotted) && <>
          <BoardToggle size="xs" pressed={tool === 'pin'} onPressedChange={on => setTool(on ? 'pin' : 'none')}><MapPinIcon aria-hidden="true"/>Pin</BoardToggle>
          <BoardToggle size="xs" pressed={tool === 'draw'} onPressedChange={on => setTool(on ? 'draw' : 'none')}><PencilIcon aria-hidden="true"/>Draw</BoardToggle>
        </>}
        {plotted && <BoardToggle size="xs" pressed={showData} onPressedChange={setShowData}><TableIcon aria-hidden="true"/>Data</BoardToggle>}
        {c.chartSource && <Confirm title="Confirm refresh" hint={`Re-run: ${c.chartSource.command}${c.chartSource.refreshedAt ? `\nLast refreshed ${new Date(c.chartSource.refreshedAt).toLocaleString()}` : ''}`} open={confirming} onOpenChange={(open, details) => {
            // An approved command runs straight away; only a first run asks.
            if (open && c.chartSource?.approved) { details.cancel(); void refresh(); return; }
            setConfirming(open);
        }} trigger={<BoardToolbarButton size="xs" disabled={refreshing} className={confirming ? 'border-(--w-bronze)/40 bg-(--w-parchment) text-(--w-parchment-ink)' : undefined}><RefreshCwIcon aria-hidden="true" className={refreshing ? 'animate-spin' : undefined}/>Refresh</BoardToolbarButton>}>
          <p className="text-muted-foreground">Refresh runs this command in the project workspace and replaces the chart&apos;s data with what it prints:</p>
          <pre className="my-2 max-h-40 overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">{c.chartSource.command}</pre>
          {c.chartSource.refreshedAt && <p className="mb-2 text-muted-foreground">Last refreshed {new Date(c.chartSource.refreshedAt).toLocaleString()}</p>}
          <div className="flex justify-end gap-1"><BoardButton size="xs" variant="ghost" onClick={() => setConfirming(false)}>Cancel</BoardButton><BoardButton size="xs" onClick={() => void refresh()}>Run</BoardButton></div>
        </Confirm>}
        {!c.prompt && <BoardToolbarButton size="xs" onClick={() => setThread({ quote: '' })}><MessageSquarePlusIcon aria-hidden="true"/>Comment</BoardToolbarButton>}
        <Hint label="Delete" shortcut="delete"><BoardToolbarButton size="xs" aria-label={`Delete ${label}`} onClick={() => onRemove(c)}><Trash2Icon aria-hidden="true"/></BoardToolbarButton></Hint>
      </BoardToolbar>
      {c.kind !== 'drawing' && !c.prompt && <Hint label="Drag to change width" side="right"><BoardWidthHandle box={c.id} type="button" aria-label={`Resize ${label}`} className={cn('absolute -right-3 top-0 bottom-0 w-2 rounded bg-primary/0 hover:bg-primary/20', handle)}/></Hint>}

      {c.prompt && <div className="inline-flex max-w-full cursor-default items-start gap-2 rounded-2xl border bg-background py-1.5 pr-3.5 pl-2.5 text-sm shadow-xs"><CornerDownRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true"/><span className="min-w-0 whitespace-pre-wrap break-words">{c.markdown}</span></div>}

      {c.kind === 'doc' && !c.prompt && (visible
        ? <BoardDocEditor card={c} label={label} onChange={edit} onComment={(quote, id) => setThread({ quote, id })} onFocus={() => useBoard.getState().anchor(c.id)}
            onBlur={empty => setTimeout(() => { if (!document.hasFocus()) return; if (useBoard.getState().quiet === c.id) useBoard.setState({ quiet: null }); const now = latest(); if (empty && document.hasFocus() && !ref.current?.contains(document.activeElement) && now.sentAt === null && now.author === 'user' && !now.comments.length) onRemove(now); }, 0)}
            onMention={(quote, id) => { const current = latest(); edit({ comments: [...current.comments, { id, quote, body: quote, author: 'user', sentAt: null, resolved: false, replies: [] }] }); setTimeout(() => onMention({ cardId: c.id, targetId: id }), 0); }}/>
        : <div className="doc-prose"><Streamdown>{c.markdown}</Streamdown></div>)}

      {c.kind === 'image' && <div className="relative">
        <span id={`image-help-${c.id}`} className="sr-only">Choose Pin or Draw, then click the image. Press Enter to pin the center.</span>
        {/* Uploaded raster assets are served by the project-scoped file route. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}/cards/${c.id}/file`} alt={label} className="block w-full rounded-md" draggable={false}/>
        <svg className={cn('absolute inset-0 h-full w-full touch-none', tool === 'none' ? 'pointer-events-none' : 'cursor-crosshair')} viewBox="0 0 1 1" preserveAspectRatio="none" role="button" tabIndex={0} aria-label="Add image pin at center; press Enter" aria-describedby={`image-help-${c.id}`}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setThread({ quote: '', x: .5, y: .5 }); } }}
          onPointerDown={e => { const p = point(e); e.stopPropagation(); if (tool === 'pin') setThread({ quote: '', ...p }); else if (tool === 'draw') { drawing.current = [p]; e.currentTarget.setPointerCapture(e.pointerId); } }}
          onPointerMove={e => { drawing.current?.push(point(e)); }}
          onPointerUp={() => { if (drawing.current) { edit({ strokes: [...latest().strokes, { id: crypto.randomUUID(), points: drawing.current, sentAt: null }] }); drawing.current = null; } }}>
          {c.strokes.map(s => <polyline key={s.id} points={s.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e44848" strokeWidth=".005"/>)}
          {c.comments.filter(t => t.x !== undefined).map((t, i) => <g key={t.id}><circle cx={t.x} cy={t.y} r=".025" fill="#e44848"/><text x={t.x} y={t.y} fontSize=".035" textAnchor="middle" dominantBaseline="central" fill="white">{i + 1}</text></g>)}
        </svg>
      </div>}

      {c.kind === 'chart' && c.chart && <BoardChart spec={c.chart} title={label} width={c.width} showData={showData} tool={plotted ? tool : 'none'} strokes={c.strokes} pins={pins}
        onPin={(anchor, quote) => { setThread({ quote, anchor }); setTool('none'); }}
        onStroke={points => edit({ strokes: [...latest().strokes, { id: crypto.randomUUID(), points, sentAt: null }] })}
        onEdit={chart => edit({ chart })}/>}

      {c.kind === 'drawing' && <svg className="block overflow-visible text-foreground" width={c.width} height={c.height} viewBox={`0 0 ${c.width} ${c.height}`} role="img" aria-label={label}>
        {c.strokes.map(s => s.points.length === 1
          ? <circle key={s.id} cx={s.points[0].x * c.width} cy={s.points[0].y * c.height} r={1.5} fill="currentColor"/>
          : <polyline key={s.id} points={s.points.map(p => `${p.x * c.width},${p.y * c.height}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}
      </svg>}

      {side && <aside data-scroll className="absolute top-0 left-[calc(100%+24px)] flex max-h-[80vh] w-80 flex-col gap-2 overflow-auto text-sm">
        {c.agentEdit && <div className="rounded-md border bg-background p-2 text-xs">Edited by agent <BoardButton size="xs" variant="outline" onClick={() => setReview(r => !r)}>Review</BoardButton>
          {review && <><DiffView before={c.agentEdit.markdown} after={c.markdown}/>{[true, false].map(keep => <BoardButton key={String(keep)} size="xs" onClick={() => onRevert(c, keep).then(() => setReview(false))}>{keep ? 'Keep' : 'Revert'}</BoardButton>)}</>}</div>}
        {thread && <div className="rounded-md border bg-background p-2">{thread.quote && <blockquote className="mb-2 border-l-2 pl-2 text-muted-foreground">{thread.quote}</blockquote>}<Composer autoFocus placeholder={`Ask a question; ${MENTION} sends immediately`} onSubmit={addComment} onCancel={() => setThread(null)}/></div>}
        {c.comments.map(t => <details key={t.id} open={!t.resolved} className="rounded-md border bg-background p-2">
          <summary>{t.anchor && <span className="mr-1.5 inline-flex size-4 items-center justify-center rounded-full bg-[#e44848] text-[10px] font-semibold text-white">{pins.find(p => p.id === t.id)?.n}</span>}{t.resolved ? 'Resolved · ' : ''}{t.body}{t.detached || t.anchor && c.chart && anchorRow(c.chart, t.anchor) < 0 ? ' (detached)' : ''}</summary>
          {t.quote && <blockquote className="my-2 border-l-2 pl-2 text-muted-foreground">{t.quote}</blockquote>}
          {t.replies.map(r => <p className="my-2" key={r.id}><b>{r.author}: </b>{r.body}</p>)}
          <Composer submitLabel="Reply" onSubmit={body => { edit({ comments: latest().comments.map(x => x.id === t.id ? { ...x, replies: [...x.replies, { id: crypto.randomUUID(), body, author: 'user', sentAt: null }] } : x) }); if (mentions(body)) onMention({ cardId: c.id, targetId: t.id }); }}/>
          <BoardButton size="xs" variant="ghost" onClick={() => edit({ comments: latest().comments.map(x => x.id === t.id ? { ...x, resolved: !x.resolved } : x) })}>{t.resolved ? 'Reopen' : 'Resolve'}</BoardButton>
        </details>)}
      </aside>}
    </BoardCard>;
});
