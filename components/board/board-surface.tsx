'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/store/board-store';
import { bounds, focusIds, intersecting, within, type Rect } from '@/lib/board/focus';
import type { MentionScope, Scope } from '@/lib/board/pending';
import type { Card } from '@/lib/board/types';
import { BoardItem } from './board-item';
import type { useViewport } from './use-viewport';

type Point = { x: number; y: number };
type Viewport = ReturnType<typeof useViewport>;
export type Tool = 'write' | 'draw';

/** World-space padding between the focus outline and the items it wraps. */
const PAD = 20;
/** Pointer travel (px) below which a background press counts as a click rather than a pan. */
const CLICK_SLOP = 4;

/** Live ids in the focus: recomputed as items move, grow or are added. */
export function useFocusIds() {
    const cards = useBoard(s => s.cards), focus = useBoard(s => s.focus);
    return useMemo(() => focusIds(cards, focus), [cards, focus]);
}

const editableTarget = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
const rectFrom = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

export function BoardSurface({ base, viewport, tool, setTool, onCreateDoc, onDraw, onUpload, onRemove, onSend, onRevert }: {
    base: string;
    viewport: Viewport;
    tool: Tool;
    setTool: (t: Tool) => void;
    onCreateDoc: (p: Point) => void;
    onDraw: (points: Point[]) => void;
    onUpload: (files: FileList | File[], at: Point) => void;
    onRemove: (c: Card) => void;
    onSend: (scope?: Scope) => void;
    onRevert: (c: Card, keep: boolean) => Promise<void>;
}) {
    const { ref, view, setView, size, toWorld } = viewport;
    const cards = useBoard(s => s.cards), board = useBoard(s => s.board), anchorId = useBoard(s => s.focus.anchorId), quiet = useBoard(s => s.quiet !== null && s.quiet === s.focus.anchorId);
    const ids = useFocusIds();
    const outline = useMemo(() => { const b = quiet ? null : bounds(cards, ids); return b && grow(b, PAD); }, [cards, ids, quiet]);
    const [live, setLive] = useState<Rect | null>(null), [stroke, setStroke] = useState<Point[] | null>(null);
    // The prompt bar under the focus outline: ⌘↵ opens it, ↵ sends the group with what was typed.
    const [asking, setAsking] = useState(false), [ask, setAsk] = useState('');
    const open = asking && ids.length > 0;
    const space = useRef(false), pointer = useRef<Point>({ x: 40, y: 40 }), world = useRef<HTMLDivElement>(null);
    const press = useRef<{ kind: 'pan' | 'marquee' | 'outline'; x: number; y: number; ox: number; oy: number; start: Point; rect?: Rect; edges?: string; moved: boolean } | null>(null);
    const state = useRef({ ids, tool, onSend, onRemove, setTool });
    useEffect(() => { state.current = { ids, tool, onSend, onRemove, setTool }; });

    useEffect(() => {
        // Capture phase so ⌘↵ wins over the editor's own Mod-Enter binding. ⌘↵ opens the prompt bar for the focus; ⇧⌘↵ always sends everything pending.
        const capture = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
            const t = e.target as HTMLElement;
            if (['INPUT', 'TEXTAREA'].includes(t.tagName)) return;
            e.preventDefault();
            e.stopPropagation();
            const { ids, onSend } = state.current;
            if (!ids.length || e.shiftKey) return onSend(undefined);
            useBoard.setState({ quiet: null });
            setAsking(true);
        };
        const down = (e: KeyboardEvent) => {
            const typing = editableTarget(e.target);
            if (e.code === 'Space' && !typing) { space.current = true; e.preventDefault(); return; }
            if (e.key === 'Escape') {
                if (state.current.tool === 'draw') return state.current.setTool('write');
                if (typing) { if ((e.target as HTMLElement).isContentEditable) (e.target as HTMLElement).blur(); return; }
                return useBoard.getState().clearFocus();
            }
            if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'd' || e.key === 'D') { e.preventDefault(); state.current.setTool(state.current.tool === 'draw' ? 'write' : 'draw'); }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const { cards, focus } = useBoard.getState(), selected = cards.find(c => c.id === focus.anchorId);
                if (selected) { e.preventDefault(); state.current.onRemove(selected); }
            }
        };
        const up = () => { space.current = false; };
        window.addEventListener('keydown', capture, true);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', up);
        return () => { window.removeEventListener('keydown', capture, true); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up); };
    }, []);

    const background = (e: React.PointerEvent) => e.target === e.currentTarget || e.target === world.current;
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !(background(e) || space.current)) return;
        const start = toWorld(e.clientX, e.clientY);
        press.current = { kind: e.shiftKey && !space.current ? 'marquee' : 'pan', x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, start, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        setAsking(false);
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        pointer.current = toWorld(e.clientX, e.clientY);
        const p = press.current;
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (Math.hypot(dx, dy) >= CLICK_SLOP) p.moved = true;
        if (!p.moved) return;
        if (p.kind === 'pan') setView(v => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
        else if (p.kind === 'marquee') setLive(rectFrom(p.start, pointer.current));
        else if (p.rect && p.edges) {
            const r = p.rect, wx = dx / view.zoom, wy = dy / view.zoom;
            let { x, y, width, height } = r;
            if (p.edges.includes('w')) { x = r.x + Math.min(wx, r.width - 40); width = r.width - (x - r.x); }
            if (p.edges.includes('e')) width = Math.max(40, r.width + wx);
            if (p.edges.includes('n')) { y = r.y + Math.min(wy, r.height - 40); height = r.height - (y - r.y); }
            if (p.edges.includes('s')) height = Math.max(40, r.height + wy);
            setLive({ x, y, width, height });
        }
    };
    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        if (p.kind === 'pan' && !p.moved && !space.current && tool === 'write') onCreateDoc(toWorld(e.clientX, e.clientY));
        if (p.kind === 'marquee' && live) {
            // Shift-drag adds whatever it touches.
            const { focus, cards } = useBoard.getState(), hit = intersecting(cards, live);
            useBoard.getState().setFocus({ add: [...new Set([...focus.add, ...hit])], remove: focus.remove.filter(id => !hit.includes(id)) });
        }
        if (p.kind === 'outline' && live) {
            // Resizing the outline redefines the focus as exactly what sits inside it, so it can shrink as well as grow.
            const { focus, cards } = useBoard.getState(), inside = within(cards, live);
            useBoard.getState().setFocus({ rect: live, fixed: true, add: [], remove: [], anchorId: focus.anchorId && inside.includes(focus.anchorId) ? focus.anchorId : null });
        }
        setLive(null);
    };
    const startOutline = (edges: string) => (e: React.PointerEvent) => {
        if (!outline) return;
        e.stopPropagation();
        e.preventDefault();
        press.current = { kind: 'outline', x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, start: toWorld(e.clientX, e.clientY), rect: outline, edges, moved: false };
        ref.current?.setPointerCapture(e.pointerId);
    };

    const drawing = useRef<Point[] | null>(null);
    const drawDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        if (space.current) return onPointerDown(e);
        e.stopPropagation();
        e.preventDefault();
        drawing.current = [toWorld(e.clientX, e.clientY)];
        setStroke(drawing.current);
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const drawMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!drawing.current) return;
        e.stopPropagation();
        drawing.current = [...drawing.current, toWorld(e.clientX, e.clientY)];
        setStroke(drawing.current);
    };
    const drawUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!drawing.current) return;
        e.stopPropagation();
        onDraw(drawing.current);
        drawing.current = null;
        setStroke(null);
    };

    const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    const handleStyle = (h: string): React.CSSProperties => {
        const s = 12 / view.zoom, half = -s / 2;
        return { width: h.length === 1 && 'ns'.includes(h) ? undefined : s, height: h.length === 1 && 'ew'.includes(h) ? undefined : s, top: h.includes('n') ? half : h.includes('s') ? undefined : s, bottom: h.includes('s') ? half : h.includes('n') ? undefined : s, left: h.includes('w') ? half : h.includes('e') ? undefined : s, right: h.includes('e') ? half : h.includes('w') ? undefined : s, cursor: `${h === 'n' || h === 's' ? 'ns' : h === 'e' || h === 'w' ? 'ew' : h === 'ne' || h === 'sw' ? 'nesw' : 'nwse'}-resize` };
    };
    const shown = live ?? outline;
    const count = `${ids.length} ${ids.length === 1 ? 'item' : 'items'}`;

    return <div ref={ref} className={cn('relative flex-1 overflow-hidden bg-muted/30 touch-none', tool === 'write' && 'cursor-text')}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { press.current = null; setLive(null); }}
      onPaste={e => { if (e.clipboardData.files.length && !editableTarget(e.target)) { e.preventDefault(); onUpload(e.clipboardData.files, pointer.current); } }}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onUpload(e.dataTransfer.files, toWorld(e.clientX, e.clientY)); }}>
      <div ref={world} className="absolute inset-0 origin-top-left" style={{ transform: `translate3d(${view.x}px,${view.y}px,0) scale(${view.zoom})`, transformOrigin: '0 0' }}>
        <svg className="pointer-events-none absolute overflow-visible text-muted-foreground" width="1" height="1" aria-hidden="true"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>{board?.edges.map(e => {
            const a = cards.find(c => c.id === e.source), b = cards.find(c => c.id === e.target);
            if (!a || !b) return null;
            const below = b.y >= a.y + a.height;
            return <line key={`${e.source}-${e.target}`} x1={below ? a.x + 16 : a.x + a.width} y1={below ? a.y + a.height + 4 : a.y + 16} x2={below ? b.x + 16 : b.x} y2={below ? b.y - 4 : b.y + 16} stroke="currentColor" opacity=".35" markerEnd="url(#arrow)"/>;
        })}</svg>
        {shown && <div aria-hidden={!outline} className={cn('pointer-events-none absolute rounded-2xl border-2 border-primary/40 bg-primary/[0.03]', !live && 'transition-[left,top,width,height] duration-150 ease-out')} style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height, borderWidth: 2 / view.zoom }}>
          {outline && !live && handles.map(h => <div key={h} aria-hidden="true" className="pointer-events-auto absolute" style={handleStyle(h)} onPointerDown={startOutline(h)}/>)}
          {outline && !live && !open && <button type="button" title="Ask about this group" className="pointer-events-auto absolute top-full right-0 mt-2 origin-top-right whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm" style={{ transform: `scale(${1 / view.zoom})` }} onPointerDown={e => e.stopPropagation()} onClick={() => setAsking(true)}>{count} · ⌘↵</button>}
          {outline && !live && open && <form className="pointer-events-auto absolute top-full left-0 mt-2 origin-top-left cursor-default" style={{ transform: `scale(${1 / view.zoom})`, width: Math.max(360, outline.width * view.zoom) }} onPointerDown={e => e.stopPropagation()}
            onSubmit={e => { e.preventDefault(); onSend({ focus: ids, ...(ask.trim() ? { prompt: ask.trim() } : {}) }); setAsk(''); setAsking(false); }}>
            <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 shadow-lg">
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">{count}</span>
              <input autoFocus value={ask} onChange={e => setAsk(e.target.value)} aria-label={`Ask about ${count}`} placeholder={`Ask about ${ids.length === 1 ? 'this item' : `these ${ids.length} items`}…`} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAsking(false); } }}/>
              <kbd className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">↵</kbd>
            </div>
            <p className="mt-1.5 px-1 text-xs text-muted-foreground">↵ send · empty ↵ sends the group as-is · esc close</p>
          </form>}
        </div>}
        {cards.map(c => {
            const visible = view.zoom >= .4 && c.x * view.zoom + view.x < size.width && (c.x + c.width) * view.zoom + view.x > 0 && c.y * view.zoom + view.y < size.height && (c.y + c.height) * view.zoom + view.y > 0;
            return <BoardItem key={c.id} card={c} base={base} zoom={view.zoom} visible={visible || c.id === anchorId} selected={c.id === anchorId} onRemove={onRemove} onMention={(s: MentionScope) => onSend(s)} onRevert={onRevert}/>;
        })}
        {stroke && <svg className="pointer-events-none absolute overflow-visible text-foreground" width="1" height="1" aria-hidden="true"><polyline points={stroke.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      {tool === 'draw' && <div aria-label="Drawing surface: drag to draw, Escape to stop" className="absolute inset-0 z-10 cursor-crosshair" onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} onPointerCancel={() => { drawing.current = null; setStroke(null); }}/>}
    </div>;
}
