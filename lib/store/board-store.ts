'use client';
import { create } from 'zustand';
import type { Board, Card, Snapshot } from '@/lib/board/types';
export const useBoard = create<{
    board: Board | null;
    cards: Card[];
    dirty: Record<string, Partial<Card>>;
    error: string | null;
    init: (s: Snapshot) => void;
    edit: (id: string, p: Partial<Card>) => void;
    merge: (c: Card) => void;
}>((set) => ({
    board: null, cards: [], dirty: {}, error: null,
    init: s => set({ ...s, dirty: {}, error: null }),
    edit: (id, p) => set(s => ({ cards: s.cards.map(c => c.id === id ? { ...c, ...p } : c), dirty: { ...s.dirty, [id]: { ...s.dirty[id], ...p } } })),
    merge: c => set(s => { const old = s.cards.find(x => x.id === c.id); if (old && old.rev >= c.rev)
        return {}; if (s.dirty[c.id])
        return { error: 'This card changed remotely. Copy your unsaved text before reloading.' }; return { cards: old ? s.cards.map(x => x.id === c.id ? c : x) : [...s.cards, c] }; }),
}));
export async function boardRequest(url: string, method = 'GET', body?: unknown) {
    const r = await fetch(url, { method, ...(body instanceof FormData ? { body } : body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
    const data = await r.json();
    if (!r.ok)
        throw new Error(data.error || 'Request failed');
    return data;
}
let saving: Promise<void> = Promise.resolve();
export function flushAll(projectId: string): Promise<void> {
    saving = saving.catch(() => { }).then(async () => {
        while (Object.keys(useBoard.getState().dirty).length) {
            const s = useBoard.getState(), id = Object.keys(s.dirty)[0], patch = s.dirty[id], card = s.cards.find(c => c.id === id)!;
            const data = await boardRequest(`/api/projects/${projectId}/board/cards/${id}`, 'PATCH', { ...patch, baseRev: card.rev });
            useBoard.setState(now => { const dirty = { ...now.dirty }; if (dirty[id] === patch)
                delete dirty[id];
            else {
                const remaining = { ...dirty[id] };
                for (const key of Object.keys(patch) as (keyof Card)[])
                    if (remaining[key] === patch[key])
                        delete remaining[key];
                if (Object.keys(remaining).length)
                    dirty[id] = remaining;
                else
                    delete dirty[id];
            } return { dirty, cards: now.cards.map(c => c.id === id ? { ...data.card, ...dirty[id] } : c) }; });
        }
    });
    return saving;
}
