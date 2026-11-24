"use client";
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CaptureInput } from './capture-input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { Capture } from '@/lib/capture/types';
import { chipLabel } from '@/lib/capture/chip';
import { label as shortcutLabel, matches, useIsMac } from '@/lib/capture/shortcut';
import { useUi } from '@/lib/store/ui-store';
import { Kbd } from '@/components/ui/kbd';
import { PenLineIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const openCapture = () => window.dispatchEvent(new Event('thunk:capture'));

/** The Capture bar: looks like a field, opens the Capture dialog. `hud` sits in the world map's top bar; `sidebar` under Search. */
export function CaptureTrigger({ variant = 'hud', className }: { variant?: 'hud' | 'sidebar'; className?: string }) {
  const shortcut = useUi((s) => s.captureShortcut);
  const mac = useIsMac();
  const hint = shortcut && mac !== null ? shortcutLabel(shortcut, mac) : '';
  return (
    <button type="button" aria-label="take a crack at" onClick={openCapture}
      className={cn('text-muted-foreground hover:text-foreground flex items-center gap-2 text-left text-sm transition-colors',
        variant === 'hud' ? 'h-8 w-full rounded-md px-2.5' : 'bg-background h-10 w-full rounded-md border px-3 hover:bg-muted/50', className)}>
      <PenLineIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">take a crack at…</span>
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}

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
  return <div role="status" aria-live="polite" className={`fixed top-[calc(4.5rem+env(safe-area-inset-top))] left-1/2 z-40 -translate-x-1/2 rounded-full border bg-background px-3 py-1 text-xs shadow transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>{label}</div>;
}

export function CaptureBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const shortcut = useUi((s) => s.captureShortcut);
  useEffect(() => {
    // Capture phase, so the shortcut wins over page handlers such as ⌘K search.
    const key = (e: KeyboardEvent) => { if (!e.repeat && matches(e, shortcut) && !(e.target as HTMLElement | null)?.closest?.('[data-shortcut-recorder]')) { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); } };
    const show = () => setOpen(true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('thunk:capture', show);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('thunk:capture', show); };
  }, [shortcut]);
  const done = useCallback(() => setSent(null), []);
  if (pathname === '/capture') return null;
  return <>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>take a crack at</DialogTitle><CaptureInput onSent={(row) => { setOpen(false); setSent(row.id); }} /></DialogContent></Dialog>
    {sent && <SentChip key={sent} id={sent} onDone={done} />}
  </>;
}
