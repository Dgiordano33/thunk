import type { Card } from './types';
export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type Focus = {
    anchorId: string | null;
    rect: Rect | null;
    add: string[];
    remove: string[];
    /** Set once the user resizes the outline: the focus is then exactly what sits inside `rect` (plus add, minus remove), not the anchor's cluster. */
    fixed?: boolean;
};
type Box = Pick<Card, 'id' | 'x' | 'y' | 'width' | 'height'>;
export const emptyFocus: Focus = { anchorId: null, rect: null, add: [], remove: [], fixed: false };
const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
/** Ids of every card reachable from the anchor through rects that sit within `gap` of each other. */
export function cluster(cards: Box[], anchorId: string, gap = 96): string[] {
    const anchor = cards.find(c => c.id === anchorId);
    if (!anchor)
        return [];
    const seen = new Set([anchor.id]), queue = [anchor];
    while (queue.length) {
        const current = queue.shift()!;
        for (const c of cards)
            if (!seen.has(c.id) && overlaps(current, c, gap)) {
                seen.add(c.id);
                queue.push(c);
            }
    }
    return cards.filter(c => seen.has(c.id)).map(c => c.id);
}
export function bounds(cards: Box[], ids: string[]): Rect | null {
    const set = new Set(ids), list = cards.filter(c => set.has(c.id));
    if (!list.length)
        return null;
    const x = Math.min(...list.map(c => c.x)), y = Math.min(...list.map(c => c.y));
    return { x, y, width: Math.max(...list.map(c => c.x + c.width)) - x, height: Math.max(...list.map(c => c.y + c.height)) - y };
}
export const intersecting = (cards: Box[], rect: Rect): string[] => cards.filter(c => overlaps(c, rect)).map(c => c.id);
/** Ids of cards whose centre lies inside `rect`, so dragging an edge past an item's middle takes it in or out. */
export const within = (cards: Box[], rect: Rect): string[] => cards.filter(c => { const x = c.x + c.width / 2, y = c.y + c.height / 2; return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height; }).map(c => c.id);
/** cluster(anchor) ∪ intersecting(rect) ∪ add − remove, in board order; a fixed focus uses within(rect) and no cluster. */
export function focusIds(cards: Box[], focus: Focus): string[] {
    const region = focus.rect ? (focus.fixed ? within : intersecting)(cards, focus.rect) : [];
    const ids = new Set([...(focus.anchorId && !focus.fixed ? cluster(cards, focus.anchorId) : []), ...region, ...focus.add]);
    for (const id of focus.remove)
        ids.delete(id);
    return cards.filter(c => ids.has(c.id)).map(c => c.id);
}
