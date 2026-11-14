'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/store/board-store';
import { bounds, focusIds, type Rect } from '@/lib/board/focus';
import type { MentionScope, Scope } from '@/lib/board/pending';
import type { Card } from '@/lib/board/types';
import { BoardItem } from './board-item';
import { BoardHandle, BoardLasso, BoardOutline, BoardRoot, BoardWorld, type BoardHandle as Handle } from './use-board-primitive';
import type { ResizeHandle } from './board-primitive';
import { Hint } from './board-ui';
import { OUTLINE, sameIds, visibleIds } from '@/lib/board/interaction';

type Point = { x: number; y: number };
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

/** The focus outline in world space: the focus's bounds plus padding, hidden while a new block is first typed. */
export function useOutline(ids: string[]): Rect | null {
    const cards = useBoard(s => s.cards), quiet = useBoard(s => s.quiet !== null && s.quiet === s.focus.anchorId);
    return useMemo(() => { const b = quiet ? null : bounds(cards, ids); return b && grow(b, PAD); }, [cards, ids, quiet]);
}

const editableTarget = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

export function BoardSurface({ base, board: handle, space, tool, setTool, onCreateDoc, onDraw, onUpload, onRemove, onSend, onRevert }: {
    base: string;
    board: Handle;
    /** Whether Space is held, which pans from anywhere. */
    space: React.RefObject<boolean>;
    tool: Tool;
    setTool: (t: Tool) => void;
    onCreateDoc: (p: Point) => void;
    onDraw: (points: Point[]) => void;
    onUpload: (files: FileList | File[], at: Point) => void;
    onRemove: (c: Card) => void;
    onSend: (scope?: Scope) => void;
    onRevert: (c: Card, keep: boolean) => Promise<void>;
}) {
    const toWorld = handle.api.viewport.toCanvas;
    const ref = useRef<HTMLDivElement>(null);
    const cards = useBoard(s => s.cards), board = useBoard(s => s.board), anchorId = useBoard(s => s.focus.anchorId);
    const ids = useFocusIds(), outline = useOutline(ids);
    const [stroke, setStroke] = useState<Point[] | null>(null);
    // The prompt bar under the focus outline: ⌘↵ opens it, ↵ sends the group with what was typed.
    const [asking, setAsking] = useState(false), [ask, setAsk] = useState('');
    const open = asking && ids.length > 0;
    const pointer = useRef<Point>({ x: 40, y: 40 }), world = useRef<HTMLDivElement>(null);
    /** A background press that hasn't moved yet: released in place, it creates a text block. */
    const click = useRef<Point | null>(null);
    // Which cards are on screen. Read before paint on mount and whenever the cards change, so a card never renders
    // static first and saves its static height; while panning or zooming, at most once a frame, re-rendering only
    // when the set changes.
    const [shownIds, setShownIds] = useState<string[]>([]);
    const readShown = useRef(() => {});
    useLayoutEffect(() => {
        let frame = 0;
        const read = () => { cancelAnimationFrame(frame); frame = 0; const next = visibleIds(useBoard.getState().cards, handle.api.viewport.visible(), handle.api.viewport.get().zoom); setShownIds(ids => sameIds(ids, next) ? ids : next); };
        readShown.current = read;
        read();
        const stop = handle.instance.subscribe(() => { frame ||= requestAnimationFrame(read); });
        const observer = new ResizeObserver(() => { frame ||= requestAnimationFrame(read); });
        if (ref.current) observer.observe(ref.current);
        return () => { stop(); observer.disconnect(); cancelAnimationFrame(frame); };
    }, [handle]);
    useLayoutEffect(() => readShown.current(), [cards]);
    const [initialTransform] = useState(() => { const v = handle.api.viewport.get(); return `translate(${v.x}px,${v.y}px) scale(${v.zoom})`; });
    const state = useRef({ ids, tool, onSend, onRemove, onRevert, setTool });
    useEffect(() => { state.current = { ids, tool, onSend, onRemove, onRevert, setTool }; });
    // Stable callbacks, so a memoized card only re-renders when its own props change.
    const [item] = useState(() => ({
        remove: (c: Card) => state.current.onRemove(c),
        mention: (s: MentionScope) => state.current.onSend(s),
        revert: (c: Card, keep: boolean) => state.current.onRevert(c, keep),
    }));

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
            // Space on a focused button presses it; anywhere else it holds the pan.
            if (e.code === 'Space' && !typing && !(e.target instanceof HTMLElement && e.target.closest('button'))) { space.current = true; e.preventDefault(); return; }
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
    }, [space]);

    const background = (e: React.PointerEvent) => e.target === e.currentTarget || e.target === world.current;
    // Runs before the primitive's own press handler, which pans, or with Shift draws a selection rectangle.
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !(background(e) || space.current)) return;
        setAsking(false);
        e.currentTarget.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
        if (!e.shiftKey || space.current) click.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        pointer.current = toWorld(e.clientX, e.clientY);
        if (click.current && Math.hypot(e.clientX - click.current.x, e.clientY - click.current.y) >= CLICK_SLOP) click.current = null;
    };
    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (click.current && !space.current && tool === 'write') onCreateDoc(toWorld(e.clientX, e.clientY));
        click.current = null;
    };
    const drawing = useRef<Point[] | null>(null);
    const drawDown = (e: React.PointerEvent<HTMLDivElement>) => {
        // While Space is held the press bubbles to the canvas, which pans.
        if (e.button !== 0 || space.current) return;
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

    const handles: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    const handleStyle = (h: string): React.CSSProperties => {
        const s = 'calc(12px / var(--canvas-zoom, 1))', half = 'calc(-6px / var(--canvas-zoom, 1))';
        return { width: h.length === 1 && 'ns'.includes(h) ? undefined : s, height: h.length === 1 && 'ew'.includes(h) ? undefined : s, top: h.includes('n') ? half : h.includes('s') ? undefined : s, bottom: h.includes('s') ? half : h.includes('n') ? undefined : s, left: h.includes('w') ? half : h.includes('e') ? undefined : s, right: h.includes('e') ? half : h.includes('w') ? undefined : s };
    };
    const count = `${ids.length} ${ids.length === 1 ? 'item' : 'items'}`;

    return <BoardRoot handle={handle} ref={ref} tabIndex={0} aria-label="Canvas" className={cn('relative flex-1 overflow-hidden bg-muted/30 touch-none outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset', tool === 'write' && 'cursor-text')}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { click.current = null; }}
      onPaste={e => { if (e.clipboardData.files.length && !editableTarget(e.target)) { e.preventDefault(); onUpload(e.clipboardData.files, pointer.current); } }}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onUpload(e.dataTransfer.files, toWorld(e.clientX, e.clientY)); }}>
      <BoardWorld ref={world} className="absolute inset-0 origin-top-left" style={{ transform: initialTransform, transformOrigin: '0 0' }}>
        <svg className="pointer-events-none absolute overflow-visible text-muted-foreground" width="1" height="1" aria-hidden="true"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>{board?.edges.map(e => {
            const a = cards.find(c => c.id === e.source), b = cards.find(c => c.id === e.target);
            if (!a || !b) return null;
            const below = b.y >= a.y + a.height;
            return <line key={`${e.source}-${e.target}`} x1={below ? a.x + 16 : a.x + a.width} y1={below ? a.y + a.height + 4 : a.y + 16} x2={below ? b.x + 16 : b.x} y2={below ? b.y - 4 : b.y + 16} stroke="currentColor" opacity=".35" markerEnd="url(#arrow)"/>;
        })}</svg>
        {outline && <BoardOutline className="group/outline pointer-events-none absolute rounded-2xl border-2 border-primary/40 bg-primary/[0.03] transition-[left,top,width,height] duration-150 ease-out in-data-moving:invisible in-data-lassoing:invisible data-resizing:transition-none" style={{ left: `var(--resize-x, ${outline.x}px)`, top: `var(--resize-y, ${outline.y}px)`, width: `var(--resize-width, ${outline.width}px)`, height: `var(--resize-height, ${outline.height}px)`, borderWidth: 'calc(2px / var(--canvas-zoom, 1))' }}>
          {handles.map(h => <BoardHandle key={h} box={OUTLINE} handle={h} aria-hidden="true" className="pointer-events-auto absolute" style={handleStyle(h)}/>)}
          {!open && <Hint label="Ask about this group" shortcut="mod+enter"><button type="button" className="pointer-events-auto absolute group-data-resizing/outline:hidden top-full right-0 mt-2 origin-top-right whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm" style={{ scale: 'calc(1 / var(--canvas-zoom, 1))' }} onPointerDown={e => e.stopPropagation()} onClick={() => setAsking(true)}>{count} · ⌘↵</button></Hint>}
          {open && <form className="pointer-events-auto absolute group-data-resizing/outline:hidden top-full left-0 mt-2 origin-top-left cursor-default" style={{ scale: 'calc(1 / var(--canvas-zoom, 1))', width: `max(360px, calc(${outline.width}px * var(--canvas-zoom, 1)))` }} onPointerDown={e => e.stopPropagation()}
            onSubmit={e => { e.preventDefault(); onSend({ focus: ids, ...(ask.trim() ? { prompt: ask.trim() } : {}) }); setAsk(''); setAsking(false); }}>
            <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 shadow-lg">
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">{count}</span>
              <input autoFocus value={ask} onChange={e => setAsk(e.target.value)} aria-label={`Ask about ${count}`} placeholder={`Ask about ${ids.length === 1 ? 'this item' : `these ${ids.length} items`}…`} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAsking(false); } }}/>
              <kbd className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">↵</kbd>
            </div>
            <p className="mt-1.5 px-1 text-xs text-muted-foreground">↵ send · empty ↵ sends the group as-is · esc close</p>
          </form>}
        </BoardOutline>}
        {cards.map(c => <BoardItem key={c.id} card={c} base={base} visible={shownIds.includes(c.id) || c.id === anchorId} selected={c.id === anchorId} onRemove={item.remove} onMention={item.mention} onRevert={item.revert}/>)}
        {stroke && <svg className="pointer-events-none absolute overflow-visible text-foreground" width="1" height="1" aria-hidden="true"><polyline points={stroke.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </BoardWorld>
      <BoardLasso className="rounded-md border border-primary/60 bg-primary/10"/>
      {tool === 'draw' && <div aria-label="Drawing surface: drag to draw, Escape to stop" className="absolute inset-0 z-10 cursor-crosshair" onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} onPointerCancel={() => { drawing.current = null; setStroke(null); }}/>}
    </BoardRoot>;
}
