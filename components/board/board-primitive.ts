import { createChange, createMove, createViewport, definePrimitive, live, type ChangeDetails, type MoveDraft, type MovePoint, type MoveReason, type Viewport, type ViewportReason } from '@ui-sdk/core';

/**
 * The canvas interaction layer: pan and zoom, and moving cards. Every UI SDK behavior the canvas uses lives here,
 * so a beta API change touches one file.
 */

export type { Viewport };
export const MIN_ZOOM = .2, MAX_ZOOM = 2;
/** How far an arrow on a card's grip moves it, and with Shift. */
export const NUDGE = 10, LARGE_NUDGE = 50;

export type BoardOptions = {
    /** Where the canvas starts; the primitive owns the viewport after that. */
    defaultViewport?: Viewport;
    onViewportChange?: (value: Viewport, details: ChangeDetails<ViewportReason>) => void;
    /** Whether a press anywhere pans, like while Space is held. */
    panning?: () => boolean;
    /** Every card's position, by id. Controlled: a move asks for new ones through `onPositionsChange`. */
    positions?: Record<string, MovePoint>;
    /** `active` is the card the user moved; the rest of the change followed it. */
    onPositionsChange?: (value: Record<string, MovePoint>, details: ChangeDetails<MoveReason> & { active?: string }) => void;
    /** The cards that move with the one pressed, like those stacked under it. */
    group?: (key: string) => string[];
};

const arrows: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

const background = (event: Event, root: HTMLElement, world: HTMLElement | undefined) => event.target === root || (!!world && event.target === world);

export const board = definePrimitive({
    name: 'board',
    options: { defaultViewport: 'value', onViewportChange: 'callback', panning: 'callback', positions: 'value', onPositionsChange: 'callback', group: 'callback' },
    controlled: ['positions'],
    state: (options: BoardOptions) => ({
        viewport: options.defaultViewport ?? { x: 0, y: 0, zoom: 1 },
        positions: options.positions ?? {},
        moving: null as MoveDraft | null,
    }),
    live: ['viewport', 'moving'],
    api: context => {
        const change = createChange(context), { store } = context;
        // Positions follow the options, except a card being dragged keeps where it started, so a remote
        // change mid-drag neither jumps the card nor moves where it lands: the local drag wins.
        let fed = context.options().positions;
        context.onOptions(options => {
            if (!options.positions || options.positions === fed) return;
            fed = options.positions;
            const { moving, positions } = store.get(), next = { ...options.positions };
            for (const key of moving?.keys ?? []) if (positions[key] && next[key]) next[key] = positions[key];
            store.set({ positions: next });
        });
        let active: string | undefined;
        const viewport = createViewport(context, {
            key: 'viewport',
            surface: () => context.element('root'),
            set: (value, details) => change('viewport', value, details),
            minZoom: () => MIN_ZOOM,
            maxZoom: () => MAX_ZOOM,
        });
        const group = (key: string) => context.options().group?.(key) ?? [key];
        const move = createMove(context, {
            key: 'positions',
            draft: 'moving',
            set: (value, details) => change('positions', value, { ...details, active }),
            group,
            scale: () => viewport.get().zoom,
        });
        return {
            viewport,
            move,
            /** Drags a card, and what is stacked under it, by its grip. */
            grab(event: PointerEvent, key: string, el: HTMLElement) {
                if (context.options().panning?.()) return;
                active = key;
                move.pointerdown(event, key, el);
                // Keeps the press from selecting text or focusing the grip, as before.
                event.preventDefault();
            },
            /** Arrows on a grip move the card by NUDGE, or LARGE_NUDGE with Shift. */
            nudge(event: KeyboardEvent, key: string) {
                const arrow = arrows[event.key];
                if (!arrow || event.altKey || event.metaKey || event.ctrlKey) return;
                event.preventDefault();
                const by = event.shiftKey ? LARGE_NUDGE : NUDGE;
                active = key;
                move.moveBy(group(key), arrow[0] * by, arrow[1] * by, { reason: 'move-key', event });
            },
            /** Wheel pans and ⌘/ctrl-wheel zooms, except over a pane of its own that scrolls. */
            wheel(event: WheelEvent) {
                if (event.target instanceof Element && event.target.closest('[data-scroll]') && !event.ctrlKey && !event.metaKey)
                    return;
                viewport.wheel(event);
            },
            /** A press on empty canvas, or anywhere while panning, drags the view. */
            press(event: PointerEvent, root: HTMLElement) {
                const panning = context.options().panning?.() ?? false;
                if (!panning && !background(event, root, context.element('world')))
                    return;
                viewport.pointerdown(event);
            },
        };
    },
    slots: slot => ({
        root: slot({
            live: live(state => ({ 'data-moving': state.moving ? '' : undefined })),
            on: {
                wheel: (event, { api }) => api.wheel(event),
                pointerdown: (event, { el, api }) => { if (el) api.press(event, el); },
                // Zoom keys only when the canvas itself has focus, so typing in a card never zooms.
                keydown: (event, { el, api }) => { if (event.target === el) api.viewport.keydown(event); },
            },
        }),
        world: slot({
            live: live((state, { api }) => ({ style: api.viewport.style(state) })),
        }),
        /** A card, keyed by its id. A drag moves it with `translate` until the drop commits. */
        card: slot<{ value: string }>({
            props: { value: 'string' },
            live: live((state, { api, key }) => ({ style: api.move.style(state, key), 'data-dragging': api.move.dragging(state, key) ? '' : undefined })),
        }),
        /** The handle that drags a card, keyed by the card's id. */
        grip: slot<{ value: string }>({
            props: { value: 'string' },
            on: {
                pointerdown: (event, { el, api, key }) => { if (el) api.grab(event, key, el); },
                keydown: (event, { api, key }) => api.nudge(event, key),
            },
        }),
    }),
});
