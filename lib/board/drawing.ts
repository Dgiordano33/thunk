import type { Card, Stroke } from './types';
/** World-space margin kept around the ink so strokes never touch the card edge. */
export const DRAWING_PAD = 12;
type Point = {
    x: number;
    y: number;
};
/**
 * Adds a stroke given in world coordinates and grows the drawing's bbox to fit it.
 * Existing strokes are re-normalised so their world positions do not move.
 */
export function extendDrawing(card: Pick<Card, 'x' | 'y' | 'width' | 'height' | 'strokes'>, worldPoints: Point[], id: string = crypto.randomUUID()): Pick<Card, 'x' | 'y' | 'width' | 'height' | 'strokes'> {
    const existing = card.strokes.map(s => ({ ...s, points: s.points.map(p => ({ x: card.x + p.x * card.width, y: card.y + p.y * card.height })) }));
    const all: Stroke[] = [...existing, { id, points: worldPoints, sentAt: null }];
    const points = all.flatMap(s => s.points);
    if (!points.length)
        return { x: card.x, y: card.y, width: card.width, height: card.height, strokes: card.strokes };
    const x = Math.min(...points.map(p => p.x)) - DRAWING_PAD, y = Math.min(...points.map(p => p.y)) - DRAWING_PAD;
    const width = Math.max(...points.map(p => p.x)) + DRAWING_PAD - x, height = Math.max(...points.map(p => p.y)) + DRAWING_PAD - y;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return { x, y, width, height, strokes: all.map(s => ({ ...s, points: s.points.map(p => ({ x: clamp((p.x - x) / width), y: clamp((p.y - y) / height) })) })) };
}
