'use client';
import { useEffect, useRef, useState } from 'react';
import { boardRequest } from '@/lib/store/board-store';
import type { Board } from '@/lib/board/types';
export type View = Board['viewport'];
/** Pan/zoom state for the canvas: wheel pans, ctrl/⌘-wheel or pinch zooms, and the viewport is persisted. */
export function useViewport(initial: View, base: string, fail: (e: unknown) => void) {
    const [view, setView] = useState(initial);
    const [size, setSize] = useState({ width: 1800, height: 1000 });
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current; if (!el) return;
        const wheel = (e: WheelEvent) => {
            if ((e.target as HTMLElement).closest('[data-scroll]') && !e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const r = el.getBoundingClientRect(), x = e.clientX-r.left, y = e.clientY-r.top;
                setView(v => { const zoom = Math.max(.2,Math.min(2,v.zoom*Math.exp(-e.deltaY*.01))); return {zoom,x:x-(x-v.x)*zoom/v.zoom,y:y-(y-v.y)*zoom/v.zoom}; });
            } else setView(v => ({...v,x:v.x-e.deltaX,y:v.y-e.deltaY}));
        };
        el.addEventListener('wheel',wheel,{passive:false});
        return () => el.removeEventListener('wheel',wheel);
    }, []);
    useEffect(() => { const el = ref.current; if (!el)
        return; const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight })); observer.observe(el); return () => observer.disconnect(); }, []);
    useEffect(() => { const t = setTimeout(() => { void boardRequest(base, 'PATCH', { viewport: view }).catch(fail); }, 500); return () => clearTimeout(t); }, [view, base, fail]);
    /** Converts a client (screen) point into board coordinates. */
    const toWorld = (clientX: number, clientY: number) => { const r = ref.current?.getBoundingClientRect(); return { x: (clientX - (r?.left ?? 0) - view.x) / view.zoom, y: (clientY - (r?.top ?? 0) - view.y) / view.zoom }; };
    return { ref, view, setView, size, toWorld };
}
