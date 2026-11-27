"use client";
import { subscribeAppEvents } from "@/lib/client/app-events";
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Capture } from '@/lib/capture/types';

/** Open captures, kept current over the captures event stream, plus the actions a row can take. */
export function useCaptures() {
  const [rows, setRows] = useState<Capture[]>([]);
  const [limit, setLimit] = useState(8);
  const [error, setError] = useState('');
  // A redirect that names a project offers to keep that routing as a Home rule.
  const [rule, setRule] = useState<{ id: string; text: string } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/captures');
      if (!r.ok) throw new Error('Could not load thoughts');
      const data = await r.json();
      setRows(data.captures); setLimit(data.limit); setError('');
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeAppEvents("captures", { onOpen: () => void refresh(), onEvent: () => void refresh() });
    return () => unsubscribe();
  }, [refresh]);
  const act = useCallback(async function act(id: string, action: string, text?: string): Promise<boolean> {
    try {
      const r = await fetch(`/api/captures/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!r.ok) throw new Error((await r.json()).error);
      await refresh();
      if (action === 'redirect' && text?.includes('#')) setRule({ id, text });
      if (action === 'discard') toast('Thought discarded', { action: { label: 'Undo', onClick: () => void act(id, 'restore') } });
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }, [refresh]);
  const retry = useCallback(async (id: string, projectId?: string) => {
    const r = await fetch(`/api/captures/${id}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
    if (!r.ok) setError((await r.json()).error);
    await refresh();
  }, [refresh]);
  return { rows, limit, error, refresh, act, retry, rule, setRule };
}
export type Captures = ReturnType<typeof useCaptures>;
