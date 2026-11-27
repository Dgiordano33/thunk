"use client";
import { subscribeAppEvents } from "@/lib/client/app-events";
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CaptureInput } from './capture-input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { Capture } from '@/lib/capture/types';
import { chipLabel } from '@/lib/capture/chip';
import { label as shortcutLabel, matches, useIsMac } from '@/lib/capture/shortcut';
import { useUi } from '@/lib/store/ui-store';
import { Kbd } from '@/components/ui/kbd';
import { Hint } from '@/components/hint';
import { PenLineIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OnboardingHint } from '@/components/onboarding/hint';
import { useOnboarding } from '@/components/onboarding/provider';

export const openCapture = () => window.dispatchEvent(new Event('thunk:capture'));

/** The Capture bar: looks like a field, opens the Capture dialog. `hud` sits in the world map's top bar; `sidebar` under the logo row. */
export function CaptureTrigger({ variant = 'hud', className }: { variant?: 'hud' | 'sidebar' | 'rail'; className?: string }) {
  const shortcut = useUi((s) => s.captureShortcut);
  const mac = useIsMac();
  const hint = shortcut && mac !== null ? shortcutLabel(shortcut, mac) : '';
  if (variant === 'rail') return (
    <Hint label="Relay a thought" keys={hint || undefined} side="right">
      <button type="button" aria-label="Relay a thought" onClick={openCapture}
        className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent flex size-9 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
        <PenLineIcon className="size-4" aria-hidden="true" />
      </button>
    </Hint>
  );
  return (
    <button type="button" aria-label="Relay a thought" onClick={openCapture}
      className={cn('text-muted-foreground hover:text-foreground flex items-center gap-2 text-left text-sm transition-colors',
        variant === 'hud' ? 'h-8 w-full rounded-md px-2.5' : 'bg-background h-9 w-full rounded-md border px-2 hover:bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring', className)}>
      <PenLineIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Relay a thought…</span>
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
    const unsubscribe = subscribeAppEvents("captures", { onOpen: () => void refresh(), onEvent: () => void refresh() });
    const cap = setTimeout(fade, MAX_MS);
    return () => { unsubscribe(); clearTimeout(cap); clearTimeout(settle); };
  }, [id, onDone]);
  if (!label) return null;
  return <div role="status" aria-live="polite" className={`fixed top-[calc(4.5rem+env(safe-area-inset-top))] left-1/2 z-40 -translate-x-1/2 rounded-full border bg-background px-3 py-1 text-xs shadow transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>{label}</div>;
}

export function CaptureBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const shortcut = useUi((s) => s.captureShortcut);
  const { markSeen } = useOnboarding();
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
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Relay a thought</DialogTitle><CaptureInput onSent={(row) => { setOpen(false); setSent(row.id); markSeen('relay'); }} /><OnboardingHint name="relay">Type a thought and press Enter. Thunk picks the project and hands it to that project&apos;s chief, which decides what it needs and starts the work. Its answer arrives in your Inbox, where you can reply to it or mark it done. Add <code>#project</code> to choose the project yourself.</OnboardingHint></DialogContent></Dialog>
    {sent && <SentChip key={sent} id={sent} onDone={done} />}
  </>;
}
