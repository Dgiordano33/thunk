import type { Board, Card } from './types';
export type MentionScope = {
    cardId: string;
    targetId: string;
};
export type FocusScope = {
    focus: string[];
    /** What the user asked about the group. Without it the group itself is the prompt. */
    prompt?: string;
};
export type Scope = MentionScope | FocusScope;
/** Per-turn image cap; matches lib/prompts/schema.ts. */
export const MAX_IMAGES = 5;
export const isFocus = (scope?: Scope): scope is FocusScope => !!scope && 'focus' in scope;
/** Cards the agent is shown as a picture. A chart only needs one once the user has drawn on it; otherwise its rows say more. */
export const isVisual = (c: Card) => c.kind === 'image' || c.kind === 'drawing' || c.kind === 'chart' && c.strokes.length > 0;
/** Reading order: top to bottom, then left to right. */
export const readingOrder = (a: Card, b: Card) => a.y - b.y || a.x - b.x;
const unsent = (c: Card) => c.markdown !== c.baselineMarkdown || (c.kind === 'image' || c.kind === 'drawing') && !c.sentAt || c.strokes.some(s => !s.sentAt) || !!c.baselineChart;
export const openThreads = (c: Card, targetId?: string) => c.comments.some(t => (!targetId || t.id === targetId) && (!t.sentAt || t.replies.some(r => !r.sentAt)));
/** The card holds something the agent has not seen yet. */
export const isFresh = (c: Card) => unsent(c) || openThreads(c);
/**
 * Everything that determines how a visual card renders for the agent. The flattened PNG uploaded before a send
 * is tagged with this, so moves and height syncs do not invalidate it but new ink or pins do.
 */
export const visualKey = (c: Card) => JSON.stringify([c.kind, c.kind === 'drawing' ? [c.width, c.height] : c.kind === 'chart' ? [c.width, c.chart] : null, c.strokes.map(s => [s.id, s.points.length]), c.comments.filter(t => t.x !== undefined || t.anchor).map(t => [t.id, t.x, t.y, t.anchor])]);
/**
 * Cards to send. In a focus, `cards` is what is new in the group and `seen` is what the agent already has;
 * both are in reading order.
 */
export function pendingOf(board: Board, cards: Card[], scope?: Scope) {
    if (isFocus(scope)) {
        const ids = new Set(scope.focus), group = cards.filter(c => ids.has(c.id)).sort(readingOrder);
        return { cards: group.filter(isFresh), seen: group.filter(c => !isFresh(c)), tombstones: [] as string[] };
    }
    if (scope)
        return { cards: cards.filter(c => c.id === scope.cardId && openThreads(c, scope.targetId)), seen: [] as Card[], tombstones: [] as string[] };
    return { cards: cards.filter(isFresh).sort(readingOrder), seen: [] as Card[], tombstones: board.tombstones };
}
/** Visual cards whose image goes with this send, and (outside a focus) the ones over the cap that wait for the next send. */
export function attachments(pending: Card[], scope?: Scope) {
    const visual = pending.filter(isVisual);
    return isFocus(scope) ? { attach: visual, held: [] as Card[] } : { attach: visual.slice(0, MAX_IMAGES), held: visual.slice(MAX_IMAGES) };
}
