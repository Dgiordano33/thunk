import type { Card } from './types';
/** Gap between a card and one placed beside or below it. */
export const GAP = 48;
type Box = Pick<Card, 'x' | 'y' | 'width' | 'height'>;
/** First free spot next to `source` (or the board origin) for a card of the given size, moving down past anything in the way. */
export function placement(cards: Box[], source?: Box, width = 900, direction: 'right' | 'below' = 'right', height = 320) {
    const x = source ? source.x + (direction === 'right' ? source.width + GAP : 0) : 40;
    let y = source ? source.y + (direction === 'below' ? source.height + GAP : 0) : 40;
    for (let i = 0; i < 500; i++) {
        const hits = cards.filter(c => x < c.x + c.width + 24 && x + width + 24 > c.x && y < c.y + c.height + 24 && y + height + 24 > c.y);
        if (!hits.length)
            break;
        y = Math.max(...hits.map(c => c.y + c.height)) + GAP;
    }
    return { x, y };
}
/** Rough rendered height of markdown at `width`, so cards placed below it start close to their final spot before the browser measures it. */
export function estimateHeight(markdown: string, width = 900) {
    const perLine = Math.max(20, Math.floor(width / 8.5));
    let height = 0, fenced = false;
    for (const line of markdown.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            height += 12;
        }
        else if (fenced)
            height += 22;
        else if (!line.trim())
            height += 10;
        else if (/^#{1,2}\s/.test(line))
            height += 46;
        else if (/^#{3,6}\s/.test(line))
            height += 36;
        else if (/^\s*\|/.test(line))
            height += /^\s*\|[\s:|-]+\|\s*$/.test(line) ? 0 : 38;
        else
            height += Math.ceil(line.length / perLine) * 27;
    }
    return Math.max(28, Math.round(height + 8));
}
