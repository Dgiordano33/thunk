import { createChange, createViewport, definePrimitive, live, type ChangeDetails, type Viewport, type ViewportReason } from '@ui-sdk/core';

/**
 * The canvas interaction layer: pan and zoom. Every UI SDK behavior the canvas uses lives here,
 * so a beta API change touches one file.
 */

export type { Viewport };
export const MIN_ZOOM = .2, MAX_ZOOM = 2;

export type BoardOptions = {
    /** Where the canvas starts; the primitive owns the viewport after that. */
    defaultViewport?: Viewport;
    onViewportChange?: (value: Viewport, details: ChangeDetails<ViewportReason>) => void;
    /** Whether a press anywhere pans, like while Space is held. */
    panning?: () => boolean;
};

const background = (event: Event, root: HTMLElement, world: HTMLElement | undefined) => event.target === root || (!!world && event.target === world);

export const board = definePrimitive({
    name: 'board',
    options: { defaultViewport: 'value', onViewportChange: 'callback', panning: 'callback' },
    state: (options: BoardOptions) => ({
        viewport: options.defaultViewport ?? { x: 0, y: 0, zoom: 1 },
    }),
    live: ['viewport'],
    api: context => {
        const change = createChange(context);
        const viewport = createViewport(context, {
            key: 'viewport',
            surface: () => context.element('root'),
            set: (value, details) => change('viewport', value, details),
            minZoom: () => MIN_ZOOM,
            maxZoom: () => MAX_ZOOM,
        });
        return {
            viewport,
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
    }),
});
