import { GAP } from './placement';
import type { Card } from './types';
type Item = Pick<Card, 'id' | 'x' | 'y' | 'width' | 'height' | 'below'>;
/**
 * Where every stacked card should sit: directly under the card it is stacked below, GAP apart, following
 * that card's measured height. Returns only the cards that need to move.
 */
export function stack(cards: Item[]): Record<string, { x: number; y: number }> {
    const byId = new Map(cards.map(c => [c.id, c]));
    const placed = new Map<string, { x: number; y: number }>(), moves: Record<string, { x: number; y: number }> = {};
    const resolve = (c: Item, path: Set<string>): { x: number; y: number } => {
        const done = placed.get(c.id);
        if (done)
            return done;
        let at = { x: c.x, y: c.y };
        const source = c.below ? byId.get(c.below) : undefined;
        if (source && !path.has(source.id)) {
            path.add(c.id);
            const s = resolve(source, path);
            at = { x: s.x, y: s.y + source.height + GAP };
        }
        placed.set(c.id, at);
        if (at.x !== c.x || at.y !== c.y)
            moves[c.id] = at;
        return at;
    };
    for (const c of cards)
        resolve(c, new Set());
    return moves;
}
