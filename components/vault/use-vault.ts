"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { isBusy, type VaultItem } from "@/lib/vault/types";

/** A project's vault items, polled every 2s while any are being read. `onSettled` fires when the last one finishes. */
export function useVault(projectId: string, { onSettled }: { onSettled?: () => void } = {}) {
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a local change (upload, re-read) may need polling to start again.
  const [kick, setKick] = useState(0);
  const settled = useRef(onSettled);
  const wasBusy = useRef(false);
  useEffect(() => {
    settled.current = onSettled;
  });

  /** Fetch, and report whether anything is still being read. */
  const refresh = useCallback(async () => {
    try {
      const { items } = await api.listVault(projectId);
      setItems(items);
      setError(null);
      const busy = items.some(isBusy);
      if (wasBusy.current && !busy) settled.current?.();
      wasBusy.current = busy;
      return busy;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the Vault");
      setItems((cur) => cur ?? []);
      return false;
    }
  }, [projectId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const loop = async () => {
      const busy = await refresh();
      if (busy && !stopped) timer = setTimeout(loop, 2000);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh, kick]);

  const replace = useCallback((item: VaultItem) => {
    setItems((cur) => cur?.map((i) => (i.id === item.id ? item : i)) ?? [item]);
    if (isBusy(item)) setKick((k) => k + 1);
  }, []);
  const remove = useCallback((id: string) => setItems((cur) => cur?.filter((i) => i.id !== id) ?? null), []);
  const add = useCallback((added: VaultItem[]) => {
    setItems((cur) => [...added, ...(cur ?? [])]);
    setKick((k) => k + 1);
  }, []);

  return { items, error, refresh, replace, remove, add };
}
