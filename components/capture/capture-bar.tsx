"use client";
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CaptureInput } from './capture-input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { Capture } from '@/lib/capture/types';
import { chipLabel } from '@/lib/capture/chip';

const SETTLED_MS = 4000;
const MAX_MS = 60_000;

/** Follows one sent capture until it reaches a worker (or fails), then fades. */
function SentChip({ id, onDone }: { id: string; onDone: () => void }) {
  const [label, setLabel] = useState<string | null>('Routing…');
  const [fading, setFading] = useState(false);
  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const fade = () => { setFading(true); settle = setTimeout(onDone, 500); };
    const refresh = async () => {
      try {
        const r = await fetch('/api/captures');
        if (!r.ok) return;
        const data = await r.json();
        const row = (data.captures as Capture[]).find((c) => c.id === id);
        const next = chipLabel(row, data.names ?? {});
        setLabel(next);
        if (!next) { onDone(); return; }
        if (row && row.status !== 'routing' && !settle) settle = setTimeout(fade, SETTLED_MS);
      } catch { /* the next event retries */ }
    };
    const events = new EventSource('/api/captures/events');
    events.onopen = () => void refresh();
    events.onmessage = () => void refresh();
    const cap = setTimeout(fade, MAX_MS);
    return () => { events.close(); clearTimeout(cap); clearTimeout(settle); };
  }, [id, onDone]);
  if (!label) return null;
  return <div role="status" aria-live="polite" className={`fixed bottom-32 right-5 z-40 rounded-full border bg-background px-3 py-1 text-xs shadow transition-opacity duration-500 md:bottom-16 ${fading ? 'opacity-0' : 'opacity-100'}`}>{label}</div>;
}

export function CaptureBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); } };
    const show = () => setOpen(true);
    window.addEventListener('keydown', key);
    window.addEventListener('thunk:capture', show);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('thunk:capture', show); };
  }, []);
  const done = useCallback(() => setSent(null), []);
  if (pathname === '/capture') return null;
  return <>
    <button aria-label="Capture a thought" className="fixed bottom-20 right-5 z-40 rounded-full border bg-background px-4 py-2 text-sm shadow md:bottom-5" onClick={() => setOpen(true)}>Capture</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Take a first crack</DialogTitle><CaptureInput onSent={(row) => { setOpen(false); setSent(row.id); }} /></DialogContent></Dialog>
    {sent && <SentChip key={sent} id={sent} onDone={done} />}
  </>;
}
