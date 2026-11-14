import { createChange, createLasso, createMove, createResize, createViewport, definePrimitive, live, type ChangeDetails, type LassoDraft, type MoveDraft, type MovePoint, type MoveReason, type ResizeBox, type ResizeDraft, type ResizeHandle, type ResizeReason, type Viewport, type ViewportReason } from '@ui-sdk/core';
import { MAX_WIDTH, MIN_OUTLINE, MIN_WIDTH, OUTLINE } from '@/lib/board/interaction';

/**
 * The canvas interaction layer: pan and zoom, moving cards, resizing them and the focus outline, and
 * Shift-drag selection. Every UI SDK behavior the canvas uses lives here,
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
    /** Each resizable card's box, and the focus outline's under OUTLINE. Controlled. */
    boxes?: Record<string, ResizeBox>;
    /** `active` is the box that changed. */
    onBoxesChange?: (value: Record<string, ResizeBox>, details: ChangeDetails<ResizeReason> & { active?: string }) => void;
    /** The ids in the focus, which a Shift-drag rectangle adds to. Controlled. */
    selected?: string[];
    onSelectedChange?: (value: string[], details: ChangeDetails<'lasso'>) => void;
};
export type { ResizeHandle };

const arrows: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

/** Where a dragged card started, which `positions` keeps for it until the drop. */
const held = (state: { positions: Record<string, MovePoint> }, key: string, dragging: boolean) => {
    const at = dragging ? state.positions[key] : undefined;
    return at && `--hold-x:${at.x}px;--hold-y:${at.y}px`;
};

const background = (event: Event, root: HTMLElement, world: HTMLElement | undefined) => event.target === root || (!!world && event.target === world);

export const board = definePrimitive({
    name: 'board',
    options: { defaultViewport: 'value', onViewportChange: 'callback', panning: 'callback', positions: 'value', onPositionsChange: 'callback', group: 'callback', boxes: 'value', onBoxesChange: 'callback', selected: 'value', onSelectedChange: 'callback' },
    controlled: ['positions', 'boxes', 'selected'],
    state: (options: BoardOptions) => ({
        viewport: options.defaultViewport ?? { x: 0, y: 0, zoom: 1 },
        positions: options.positions ?? {},
        moving: null as MoveDraft | null,
        boxes: options.boxes ?? {},
        sizing: null as ResizeDraft | null,
        selected: options.selected ?? [],
        lasso: null as LassoDraft | null,
    }),
    sync: options => ({ ...(options.boxes ? { boxes: options.boxes } : {}), ...(options.selected ? { selected: options.selected } : {}) }),
    live: ['viewport', 'moving', 'sizing', 'lasso'],
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
        let sized: string | undefined;
        const resize = createResize(context, {
            boxes: state => state.boxes,
            draft: 'sizing',
            set: (value, details) => change('boxes', value, { ...details, active: sized }),
            min: key => key === OUTLINE ? { width: MIN_OUTLINE, height: MIN_OUTLINE } : { width: MIN_WIDTH, height: 1 },
            max: key => key === OUTLINE ? undefined : { width: MAX_WIDTH, height: Number.MAX_SAFE_INTEGER },
            scale: () => viewport.get().zoom,
        });
        const lasso = createLasso(context, {
            slot: 'card',
            draft: 'lasso',
            selected: () => store.get().selected,
            set: (keys, details) => change('selected', keys, details),
        });
        return {
            viewport,
            move,
            resize,
            lasso,
            /** Drags a handle on a card's edge or the focus outline. */
            size(event: PointerEvent, key: string, handle: ResizeHandle, el: HTMLElement) {
                if (context.options().panning?.()) return;
                sized = key;
                resize.pointerdown(event, key, handle, el);
                event.preventDefault();
            },
            /** Left and right on a card's width handle change its width by NUDGE, or LARGE_NUDGE with Shift. */
            widen(event: KeyboardEvent, key: string) {
                const arrow = arrows[event.key];
                if (!arrow?.[0] || event.altKey || event.metaKey || event.ctrlKey) return;
                event.preventDefault();
                sized = key;
                resize.resizeBy(key, 'e', arrow[0] * (event.shiftKey ? LARGE_NUDGE : NUDGE), 0, { reason: 'resize-key', event });
            },
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
            /** A press on empty canvas, or anywhere while panning, drags the view; with Shift it draws a selection. */
            press(event: PointerEvent, root: HTMLElement) {
                const panning = context.options().panning?.() ?? false;
                if (!panning && !background(event, root, context.element('world')))
                    return;
                if (event.shiftKey && !panning) lasso.pointerdown(event, root);
                else viewport.pointerdown(event);
            },
        };
    },
    slots: slot => ({
        root: slot({
            live: live(state => ({ 'data-moving': state.moving ? '' : undefined, 'data-lassoing': state.lasso ? '' : undefined })),
            on: {
                wheel: (event, { api }) => api.wheel(event),
                pointerdown: (event, { el, api }) => { if (el) api.press(event, el); },
                // Zoom keys only when the canvas itself has focus, so typing in a card never zooms.
                keydown: (event, { el, api }) => { if (event.target === el) api.viewport.keydown(event); },
            },
        }),
        /** The Shift-drag rectangle, in screen space over the world; hidden until one is drawn. */
        lasso: slot({
            attrs: () => ({ 'aria-hidden': 'true' }),
            live: live((state, { api }) => ({ style: api.lasso.style(state) })),
        }),
        world: slot({
            live: live((state, { api }) => ({ style: api.viewport.style(state) })),
        }),
        /**
         * A card, keyed by its id. A drag moves it with `translate` until the drop commits. While it is dragged it
         * also holds where it started (`--hold-x/y`, read by the card's left and top), so a remote change to its
         * position, or to the card it is stacked under, doesn't move it under the pointer.
         */
        card: slot<{ value: string }>({
            props: { value: 'string' },
            live: live((state, { api, key }) => ({
                style: [api.move.style(state, key), api.resize.style(state, key), held(state, key, api.move.dragging(state, key))].filter(Boolean).join(';') || undefined,
                'data-dragging': api.move.dragging(state, key) ? '' : undefined,
            })),
        }),
        /** The focus outline; a drag of its handles sets `--resize-*` until the drop. */
        outline: slot({
            live: live((state, { api }) => ({ style: api.resize.style(state, OUTLINE), 'data-resizing': api.resize.dragging(state, OUTLINE) ? '' : undefined })),
        }),
        /** A resize handle, keyed `${box}:${handle}`: a card's width edge or one of the outline's eight. */
        handle: slot<{ value: string; box: string; handle: ResizeHandle }>({
            props: { value: 'string', box: 'string', handle: 'string' },
            attrs: (_state, { props, api }) => api.resize.handleAttrs(props.handle),
            on: {
                pointerdown: (event, { el, api, props }) => { if (el) api.size(event, props.box, props.handle, el); },
                keydown: (event, { api, props }) => { if (props.box !== OUTLINE) api.widen(event, props.box); },
            },
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
