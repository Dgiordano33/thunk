'use client';
import { create } from 'zustand';
import type { Board, Card, Snapshot } from '@/lib/board/types';
import { emptyFocus, focusIds, type Focus } from '@/lib/board/focus';
import { stack } from '@/lib/board/layout';
const GEOMETRY = new Set(['x', 'y', 'width', 'height', 'below']);
type Dirty = Record<string, Partial<Card>>;
/** Moves stacked cards back under their source, recording each move as an unsaved edit. */
function settle(cards: Card[], dirty: Dirty) {
    const moves = stack(cards);
    if (!Object.keys(moves).length)
        return { cards, dirty };
    const next = { ...dirty };
    for (const [id, at] of Object.entries(moves))
        next[id] = { ...next[id], ...at };
    return { cards: cards.map(c => moves[c.id] ? { ...c, ...moves[c.id] } : c), dirty: next };
}
/** A local draft is only created on the server once it holds something. */
const worthSaving = (c: Card) => !!c.markdown.trim() || c.comments.length > 0;
export const useBoard = create<{
    board: Board | null;
    cards: Card[];
    dirty: Dirty;
    /** Text blocks that exist only in this tab until the user types into them. */
    drafts: Record<string, true>;
    error: string | null;
    focus: Focus;
    /** A block being typed for the first time: its focus outline stays hidden until it loses focus. */
    quiet: string | null;
    init: (s: Snapshot) => void;
    edit: (id: string, p: Partial<Card>) => void;
    merge: (c: Card) => void;
    /** Adds a block locally, without a server round trip. */
    draft: (c: Card) => void;
    /** Drops a card from local state (after deleting it, or when discarding a draft). */
    discard: (id: string) => void;
    setFocus: (f: Partial<Focus>) => void;
    /** Make `id` the focus anchor; picking something outside the current focus starts a fresh one. */
    anchor: (id: string) => void;
    /** Shift-click: add the item to the focus, or take it out if it is already in. */
    toggle: (id: string) => void;
    clearFocus: () => void;
}>((set, get) => ({
    board: null, cards: [], dirty: {}, drafts: {}, error: null, focus: emptyFocus, quiet: null,
    init: s => set({ ...s, dirty: {}, drafts: {}, error: null, focus: emptyFocus }),
    edit: (id, p) => set(s => !s.cards.some(c => c.id === id) ? {} : settle(s.cards.map(c => c.id === id ? { ...c, ...p } : c), { ...s.dirty, [id]: { ...s.dirty[id], ...p } })),
    merge: c => set(s => { const old = s.cards.find(x => x.id === c.id); if (old && old.rev >= c.rev)
        return {}; const local = s.dirty[c.id];
        if (local && !Object.keys(local).every(k => GEOMETRY.has(k)))
            return { error: 'This card changed remotely. Copy your unsaved text before reloading.' };
        const next = { ...c, ...local }; return settle(old ? s.cards.map(x => x.id === c.id ? next : x) : [...s.cards, next], s.dirty); }),
    draft: c => set(s => ({ cards: [...s.cards, c], drafts: { ...s.drafts, [c.id]: true } })),
    discard: id => set(s => { const dirty = { ...s.dirty }, drafts = { ...s.drafts }; delete dirty[id]; delete drafts[id];
        return { cards: s.cards.filter(x => x.id !== id), dirty, drafts, quiet: s.quiet === id ? null : s.quiet, focus: { ...s.focus, anchorId: s.focus.anchorId === id ? null : s.focus.anchorId, add: s.focus.add.filter(x => x !== id) } }; }),
    setFocus: f => set(s => ({ focus: { ...s.focus, ...f } })),
    anchor: id => set(s => s.focus.anchorId === id ? {} : { quiet: null, focus: focusIds(s.cards, s.focus).includes(id) ? { ...s.focus, anchorId: id, remove: s.focus.remove.filter(x => x !== id) } : { ...emptyFocus, anchorId: id } }),
    toggle: id => { const { focus, cards } = get(), inside = focusIds(cards, focus).includes(id); set({ focus: inside ? { ...focus, add: focus.add.filter(x => x !== id), remove: [...focus.remove, id] } : { ...focus, add: [...focus.add, id], remove: focus.remove.filter(x => x !== id) } }); },
    clearFocus: () => set({ focus: emptyFocus, quiet: null }),
}));
/** Edits that still need saving: empty drafts are left alone until they get content. */
export function unsavedIds() {
    const { dirty, drafts, cards } = useBoard.getState();
    return Object.keys(dirty).filter(id => { const c = cards.find(x => x.id === id); return !drafts[id] || !c || worthSaving(c); });
}
export async function boardRequest(url: string, method = 'GET', body?: unknown) {
    const r = await fetch(url, { method, ...(body instanceof FormData ? { body } : body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
    const data = await r.json();
    if (!r.ok)
        throw new Error(data.error || 'Request failed');
    return data;
}
let saving: Promise<void> = Promise.resolve();
export function flushAll(projectId: string): Promise<void> {
    const base = `/api/projects/${projectId}/board/cards`;
    saving = saving.catch(() => { }).then(async () => {
        for (let id = unsavedIds()[0]; id; id = unsavedIds()[0]) {
            const s = useBoard.getState(), patch = s.dirty[id], card = s.cards.find(c => c.id === id);
            if (!card) {
                useBoard.setState(now => { const dirty = { ...now.dirty }; delete dirty[id]; return { dirty }; });
                continue;
            }
            const data = s.drafts[id]
                ? await boardRequest(base, 'POST', { id, kind: 'doc', title: card.title, markdown: card.markdown, ...(card.contentJson ? { contentJson: card.contentJson } : {}), x: card.x, y: card.y, width: card.width, height: card.height })
                : await boardRequest(`${base}/${id}`, 'PATCH', { ...patch, baseRev: card.rev });
            useBoard.setState(now => { const dirty = { ...now.dirty }, drafts = { ...now.drafts }; delete drafts[id]; if (dirty[id] === patch)
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
            } return { dirty, drafts, cards: now.cards.map(c => c.id === id ? { ...data.card, ...dirty[id] } : c) }; });
        }
    });
    return saving;
}
