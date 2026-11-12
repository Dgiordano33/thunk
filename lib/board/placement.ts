import type { Card } from './types';
export function placement(cards: Card[], source?: Card, width = 420, direction: 'right' | 'below' = 'right') {
    let x = source ? source.x + (direction === 'right' ? source.width + 48 : 0) : 40, y = source ? source.y + (direction === 'below' ? source.height + 48 : 0) : 40;
    let shifts = 0;
    while (cards.some(c => x < c.x + c.width + 24 && x + width + 24 > c.x && y < c.y + c.height + 24 && y + 344 > c.y)) {
        y += 368;
        if (++shifts % 8 === 0) {
            x += width + 48;
            y = 40;
        }
    }
    return { x, y };
}
