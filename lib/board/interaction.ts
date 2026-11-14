import { intersecting, within, type Focus, type Rect } from './focus';
import type { Card } from './types';

/**
 * Pure helpers between the canvas store and its interaction primitive: what the primitive is fed
 * (positions, boxes, what is on screen) and the store patches its gestures turn into.
 */

type Item = Pick<Card, 'id' | 'x' | 'y' | 'width' | 'height'>;
export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
/** A rectangle by its edges, as the viewport reports what is on screen. */
export type Edges = { left: number; top: number; right: number; bottom: number };

/** The resize key of the focus outline, beside the cards' own ids. */
export const OUTLINE = '@focus';
/** Below this zoom every card renders static. */
export const LIVE_ZOOM = .4;
export const MIN_WIDTH = 120, MAX_WIDTH = 2000;
/** The smallest the focus outline gets, in canvas units. */
export const MIN_OUTLINE = 40;

/** Every card's position, by id. `frozen` keeps keys a gesture is dragging at the position it started from. */
export function positionsOf(cards: Item[], frozen?: { keys: string[]; from: Record<string, Point> }): Record<string, Point> {
    const out: Record<string, Point> = {};
    for (const c of cards)
        out[c.id] = frozen?.keys.includes(c.id) && frozen.from[c.id] ? frozen.from[c.id] : { x: c.x, y: c.y };
    return out;
}

/** The boxes the resize behavior changes: each resizable card, plus the focus outline while there is one. */
export function boxesOf(cards: (Item & Pick<Card, 'kind' | 'prompt'>)[], outline: Rect | null): Record<string, Box> {
    const out: Record<string, Box> = {};
    for (const c of cards)
        if (c.kind !== 'drawing' && !c.prompt)
            out[c.id] = { x: c.x, y: c.y, width: c.width, height: c.height };
    if (outline)
        out[OUTLINE] = { ...outline };
    return out;
}

/** The card pressed, then every card stacked below it, directly or through others; safe against `below` cycles. */
export function stackGroup(cards: Pick<Card, 'id' | 'below'>[], id: string): string[] {
    const group = [id], seen = new Set(group);
    for (let i = 0; i < group.length; i++)
        for (const c of cards)
            if (c.below === group[i] && !seen.has(c.id)) {
                seen.add(c.id);
                group.push(c.id);
            }
    return group;
}

/**
 * Store patches for a move: every card whose position changed. The card the user moved (`active`) is unstacked;
 * the cards stacked under it keep following it. Ids no longer on the board are ignored.
 */
export function movePatches(cards: Pick<Card, 'id' | 'x' | 'y' | 'below'>[], next: Record<string, Point>, active?: string): Record<string, Partial<Card>> {
    const out: Record<string, Partial<Card>> = {};
    for (const c of cards) {
        const at = next[c.id];
        if (!at || (at.x === c.x && at.y === c.y))
            continue;
        out[c.id] = { x: at.x, y: at.y, ...(c.id === active && c.below ? { below: null } : {}) };
    }
    return out;
}

/** A card width from a resize: whole pixels, kept within bounds. */
export const widthPatch = (width: number): Pick<Card, 'width'> => ({ width: Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))) });

/**
 * The focus after a Shift-drag rectangle. `keys` is the selection it ends with: the focus before (`inFocus`) plus
 * what it touched. Only cards not already in focus join `add`, so cards in it through the anchor's cluster stay
 * there for that reason alone and leave when moved away; a joining card is no longer excluded.
 */
export function lassoFocus(focus: Focus, keys: string[], inFocus: string[]): Partial<Focus> {
    const before = new Set(inFocus), joined = keys.filter(id => !before.has(id)), hit = new Set(joined);
    return { add: [...new Set([...focus.add, ...joined])], remove: focus.remove.filter(id => !hit.has(id)) };
}

/** The focus after resizing its outline: exactly what sits inside, keeping the anchor only if it still does. */
export function outlineFocus(cards: Item[], focus: Focus, box: Box): Focus {
    const rect = { x: box.x, y: box.y, width: box.width, height: box.height }, inside = within(cards, rect);
    return { rect, fixed: true, add: [], remove: [], anchorId: focus.anchorId && inside.includes(focus.anchorId) ? focus.anchorId : null };
}

/** Cards on screen, which render live; none at all below LIVE_ZOOM. Touching an edge doesn't count. */
export function visibleIds(cards: Item[], view: Edges, zoom: number): string[] {
    if (zoom < LIVE_ZOOM)
        return [];
    return intersecting(cards, { x: view.left, y: view.top, width: view.right - view.left, height: view.bottom - view.top });
}

/** Whether two id lists hold the same ids in the same order. */
export const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
