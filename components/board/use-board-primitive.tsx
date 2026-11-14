'use client';
import { useEffect, useRef, useState } from 'react';
import { usePart, usePrimitive, type PartProps, type PrimitiveHandle } from '@ui-sdk/react/primitive';
import { boardRequest } from '@/lib/store/board-store';
import { board, type BoardOptions, type ResizeHandle, type Viewport } from './board-primitive';

export type BoardHandle = PrimitiveHandle<typeof board>;

/** The canvas primitive for a board: seeds the viewport, persists it 500ms after the last change. */
export function useBoardPrimitive(initial: Viewport, base: string, fail: (e: unknown) => void, options: Omit<BoardOptions, 'defaultViewport' | 'onViewportChange'>) {
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const latest = useRef({ base, fail });
    useEffect(() => { latest.current = { base, fail }; });
    useEffect(() => () => clearTimeout(timer.current), []);
    return usePrimitive(board, {
        ...options,
        defaultViewport: initial,
        onViewportChange: viewport => {
            clearTimeout(timer.current);
            timer.current = setTimeout(() => { const { base, fail } = latest.current; void boardRequest(base, 'PATCH', { viewport }).catch(fail); }, 500);
        },
    });
}

/** The viewport as React state, at most once a frame, for what has to re-render with it. */
export function useView(handle: BoardHandle): Viewport {
    const [view, setView] = useState<Viewport>(() => handle.instance.get().viewport);
    useEffect(() => {
        let frame = 0;
        const read = () => { frame = 0; const next = handle.instance.get().viewport; setView(v => v.x === next.x && v.y === next.y && v.zoom === next.zoom ? v : next); };
        const stop = handle.instance.subscribe(() => { frame ||= requestAnimationFrame(read); });
        return () => { stop(); cancelAnimationFrame(frame); };
    }, [handle]);
    return view;
}

/** The canvas frame: clips the world and takes wheel, pan and zoom keys. */
export function BoardRoot({ handle, ...props }: { handle: BoardHandle } & PartProps<'div'>) {
    return usePart(handle, 'root', {}, props, 'div');
}

/** Holds every item, moved by one transform. */
export function BoardWorld(props: PartProps<'div'>) {
    return usePart(board, 'world', {}, props, 'div');
}

/** A card's own element, keyed by its id. */
export function BoardCard({ value, ...props }: { value: string } & PartProps<'article'>) {
    return usePart(board, 'card', { value }, props, 'article');
}

/** Drags the card `value`; arrows nudge it. */
export function BoardGrip({ value, ...props }: { value: string } & PartProps<'button'>) {
    return usePart(board, 'grip', { value }, props, 'button');
}

/** The focus outline's frame. */
export function BoardOutline(props: PartProps<'div'>) {
    return usePart(board, 'outline', {}, props, 'div');
}

/** A resize handle on `box`: a card id, or the focus outline. */
export function BoardHandle({ box, handle, ...props }: { box: string; handle: ResizeHandle } & PartProps<'div'>) {
    return usePart(board, 'handle', { value: `${box}:${handle}`, box, handle }, props, 'div');
}

/** The handle on a card's right edge that changes its width; arrows step it. */
export function BoardWidthHandle({ box, ...props }: { box: string } & PartProps<'button'>) {
    return usePart(board, 'handle', { value: `${box}:e`, box, handle: 'e' }, props, 'button');
}
