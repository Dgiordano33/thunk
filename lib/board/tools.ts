import 'server-only';
import { z } from 'zod';
import path from 'node:path';
import type { LiveSession } from '@/lib/agent/session-registry';
import type { HarnessEventBody } from '@/lib/agent/types';
import { projectBoardsDir } from '@/lib/projects/paths';
import { canvasPath } from '@/lib/routes';
import { addCard, lock, readCard, saveCard, snapshot, validId } from './store';
import { addImageCard, createCanvas, listCanvases } from './service';
import { emitBoardChange } from './events';
import { readFile, stat } from 'node:fs/promises';
import { reanchor } from './anchors';
import type { Card } from './types';
import { MAX_SLICES, chartHeight, chartShape, parseChart } from './chart';
const sourceCommand = z.string().min(1).max(4000);
const SOURCE_HELP = 'When the rows come from a query or script you ran, pass it as source_command: a shell command, run from the project workspace directory, that prints the chart data as JSON on stdout (an array of row objects, or {"rows": [...]}; for stat, an array of stats). The user can then press Refresh to re-run it and swap in fresh rows without a turn; they confirm the command the first time. Only pass a command you have run and that printed exactly this shape.';
export const BOARD_TOOL_NAMES = ['canvas_read', 'canvas_add_card', 'canvas_add_image', 'canvas_add_chart', 'canvas_edit_chart', 'canvas_edit_card', 'canvas_reply', 'canvas_comment'];
/** Canvas tools for sessions that aren't a canvas's own agent: workers, scouts, chats. Each names its canvas. */
export const CANVAS_TOOL_NAMES = ['canvas_list', 'canvas_create', 'canvas_read', 'canvas_add_card', 'canvas_add_image', 'canvas_add_chart', 'canvas_edit_chart', 'canvas_edit_card'];
export const boardPrompt = `You collaborate on the project's Canvas, a spatial board. Use canvas_read to inspect it and canvas_add_card, canvas_edit_card, canvas_comment and canvas_reply to deliver work. Answer every pending thread. Preserve user edits. Use source_card_id to connect responses. Images are available by absolute path with Read. Final prose is only a short activity summary; put substantive content on cards. AskUserQuestion is available for blocking questions. A canvas_update with mode="focus" means the user selected that group of cards as their prompt: answer the group as a whole with one canvas_add_card placed below its last card, not by editing or commenting on each card. In a follow-up focus, cards marked seen="true" are earlier turns you already have; answer the new cards in that context. When a focus update carries an <instruction>, that is the user's question about the group: answer it under the prompt card named in the update. Cards with prompt=true are earlier instructions shown as chips; never edit them. Cards with kind="drawing" are freehand sketches; their rendered PNG is attached to the turn and available at the drawing path from canvas_read. Deliver anything that is not prose as its own separate canvas object, never embedded in a text card: a table goes in its own canvas_add_card containing only the markdown table; a chart or graph of data (a trend, a comparison, headline numbers) goes through canvas_add_chart, which takes the data itself as rows and renders it in the app's style with hover values and a table view, so never draw data as SVG; correct or extend a chart with canvas_edit_chart rather than adding another; when its rows came from a command you ran, register it as source_command so the user can refresh it. Users can edit chart rows by hand (the update carries a <user_data_edit> diff), pin data points (threads with an anchor naming the row's x value and series) and draw on charts (the rendered PNG is attached). A picture, diagram or other graphic that is not a plot of data goes through canvas_add_image (author it as SVG with explicit width, height and viewBox, or pass the path of a PNG/JPEG/WebP you produced). Cards with kind="chart" carry their data in the chart field of canvas_read. Put explanatory prose in a separate text card and chain the objects with source_card_id and placement="below" so they stack under the prompt in order.`;
export const canvasPrompt = `# Canvas
The project has Canvases: spatial boards of text cards, tables, charts and images the person opens in Thunk. When the person asks for a canvas, board, or a visual layout of your work, build it with the canvas tools; otherwise deliver work as usual. canvas_create makes a new canvas and returns its id (use canvas_list to find an existing one, "main" is the project's main canvas, and add to an existing canvas only when the person names it). Pass that canvas_id to canvas_add_card, canvas_add_chart, canvas_add_image, canvas_edit_card, canvas_edit_chart and canvas_read. Deliver anything that is not prose as its own object: a table as its own canvas_add_card containing only the markdown table, data (trends, comparisons, headline numbers) through canvas_add_chart with the rows themselves, never drawn as SVG, and diagrams or other graphics through canvas_add_image. Put explanatory prose in separate text cards and chain objects with source_card_id and placement="below" so they read in order. Canvas writes are Thunk data, not repository changes, so they are allowed in read-only sessions. Finish by naming the canvas and its path in your final response.`;

const placementShape = { source_card_id: z.string().optional(), placement: z.enum(['right', 'below']).optional() };
const shapes = {
    read: { card_ids: z.array(z.string()).optional(), include_images: z.boolean().optional() },
    addCard: { markdown: z.string().max(100000), title: z.string().max(200).optional(), in_reply_to: z.string().optional(), width: z.number().min(120).max(2000).optional(), ...placementShape },
    addImage: { svg: z.string().max(2000000).optional(), path: z.string().max(4000).optional(), title: z.string().max(200).optional(), width: z.number().min(120).max(2000).optional(), ...placementShape },
    addChart: { ...chartShape, title: z.string().min(1).max(200), source_command: sourceCommand.optional(), width: z.number().min(240).max(2000).optional(), ...placementShape },
    editChart: { card_id: z.string(), title: z.string().min(1).max(200).optional(), source_command: sourceCommand.nullable().optional(), ...Object.fromEntries(Object.entries(chartShape).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof chartShape]: z.ZodOptional<(typeof chartShape)[K]> } },
    editCard: { card_id: z.string(), markdown: z.string().max(100000).optional(), edits: z.array(z.object({ old_string: z.string().min(1), new_string: z.string() })).optional(), summary: z.string().optional() },
};
type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;
const DESCRIPTIONS = {
    read: 'Read Canvas cards (kind doc, image, drawing or chart), their x/y/width/height geometry, image paths and chart data.',
    addCard: 'Add a response card (900px wide by default).',
    addImage: 'Add a picture, diagram or other graphic as its own canvas object (plots of data go through canvas_add_chart). Provide exactly one of svg (inline SVG markup with width, height and viewBox) or path (absolute path to a PNG, JPEG, GIF, WebP or SVG file).',
    addChart: `Add a chart of data as its own canvas object. type "line" (change over time), "bar" (comparison across categories), "pie" (parts of a whole) and "scatter" (relationship between two measures) need x (the row key holding each row's x value), series (the numeric row keys to plot, at most 8, with display labels) and rows (one object per x value, in order). Line, bar and pie x values are unique labels; scatter x values are numbers and may repeat. A pie has exactly one series of non-negative values, one slice per row; more than ${MAX_SLICES} slices are folded into "Other", so prefer few. stacked=true stacks a bar chart's series into one bar per row (a breakdown of a total). All series share one y axis, so plot measures of different scale as separate charts. type "stat" shows headline numbers and needs stats instead. unit labels the values ("$", "%", "ms"). ${SOURCE_HELP}`,
    editChart: 'Change a chart card in place. Pass only the fields to replace; rows, series and stats are replaced whole. source_command replaces the Refresh command; pass null to remove it.',
    editCard: 'Edit a card; exact old_string must occur once.',
};

/** The card operations both tool sets share. `publish` broadcasts a saved card and returns the tool's result. */
function operations(publish: (card: Card) => Promise<string>) {
    return {
        read: async (dir: string, a: Args<typeof shapes.read>) => JSON.stringify((await snapshot(dir)).cards.map(c => ({ ...c, contentJson: undefined, strokes: c.kind === 'drawing' ? c.strokes.length : c.strokes, markdown: a.card_ids?.includes(c.id) ? c.markdown : c.markdown.slice(0, 300), asset: c.asset ? path.join(dir, 'assets', c.asset) : undefined, drawing: c.kind === 'drawing' || c.kind === 'chart' && c.strokes.length ? path.join(dir, 'assets', `${c.id}.annotated.png`) : undefined }))),
        addCard: (dir: string, a: Args<typeof shapes.addCard>) => lock(dir, async () => { const sourceId = a.source_card_id ?? (a.in_reply_to ? (await snapshot(dir)).cards.find(c => c.comments.some(t => t.id === a.in_reply_to))?.id : undefined); if (a.in_reply_to && !sourceId) throw new Error('Reply target not found'); return publish(await addCard(dir, { ...(a.width ? { width: a.width } : {}), title: a.title || 'Response', markdown: a.markdown, baselineMarkdown: a.markdown, author: 'agent', sentAt: new Date().toISOString() }, sourceId, a.placement)); }),
        addImage: async (dir: string, a: Args<typeof shapes.addImage>) => {
            if ((a.svg === undefined) === (a.path === undefined))
                throw new Error('Provide svg or path');
            if (a.svg !== undefined && !/<svg[\s>]/i.test(a.svg))
                throw new Error('svg must be SVG markup');
            if (a.path !== undefined && !path.isAbsolute(a.path))
                throw new Error('path must be absolute');
            const ext = a.path ? path.extname(a.path).slice(1).toLowerCase() : 'svg';
            const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' } as Record<string, string>)[ext];
            if (!mime)
                throw new Error('Unsupported image type');
            return publish(await addImageCard(dir, { bytes: a.path ? await readFile(a.path) : Buffer.from(a.svg!), mime, origin: 'generated', prompt: a.title, source: a.source_card_id, width: a.width ?? 640, placement: a.placement }));
        },
        addChart: (dir: string, { title, source_command, source_card_id, width = 640, placement, ...spec }: Args<typeof shapes.addChart>) => lock(dir, async () => { const chart = parseChart(spec); return publish(await addCard(dir, { kind: 'chart', chart, title, width, height: chartHeight(chart, width), ...(source_command ? { chartSource: { command: source_command } } : {}), author: 'agent', sentAt: new Date().toISOString() }, source_card_id, placement)); }),
        editChart: (dir: string, { card_id, title, source_command, ...changes }: Args<typeof shapes.editChart>) => lock(dir, async () => {
            const c = await readCard(dir, card_id);
            if (c.kind !== 'chart' || !c.chart)
                throw new Error('Not a chart');
            c.chart = parseChart({ ...c.chart, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) });
            // The agent has now seen and rewritten the chart, so any hand edit is part of what it knows.
            delete c.baselineChart;
            if (title)
                c.title = title;
            // A new command needs the user's confirmation again before Refresh runs it.
            if (source_command === null)
                delete c.chartSource;
            else if (source_command && source_command !== c.chartSource?.command)
                c.chartSource = { command: source_command };
            return publish(await saveCard(dir, c));
        }),
        editCard: (dir: string, a: Args<typeof shapes.editCard>) => lock(dir, async () => {
            const c = await readCard(dir, a.card_id);
            if (c.kind !== 'doc')
                throw new Error('Not a document');
            if ((a.markdown === undefined) === (a.edits === undefined))
                throw new Error('Provide markdown or edits');
            let markdown = a.markdown ?? c.markdown;
            for (const edit of a.edits ?? []) {
                if (markdown.split(edit.old_string).length !== 2)
                    throw new Error('old_string must match exactly once');
                markdown = markdown.replace(edit.old_string, edit.new_string);
            }
            c.agentEdit ??= { markdown: c.markdown, contentJson: c.contentJson, summary: a.summary || 'Edited by agent' };
            c.markdown = markdown;
            c.baselineMarkdown = markdown;
            delete c.contentJson;
            c.comments = reanchor(markdown, c.comments);
            return publish(await saveCard(dir, c));
        }),
    };
}

function tool<S extends z.ZodRawShape>(name: string, description: string, schema: S, run: (args: Args<S>) => Promise<string>) {
    return { name, description, schema, handler: async (input: unknown) => { try {
            return { content: [{ type: 'text' as const, text: await run(z.strictObject(schema).parse(input)) }] };
        }
        catch (e) {
            return { isError: true, content: [{ type: 'text' as const, text: String(e) }] };
        } } };
}

/**
 * `emit` is handed in by the caller instead of imported here: this module sits inside the session registry's import
 * cycle, and loading the registry from a tool call can re-enter it half-initialised after a dev hot reload.
 */
export function boardTools(live: LiveSession, emit: (live: LiveSession, body: HarnessEventBody) => void) {
    if (live.meta.origin?.kind !== 'board')
        return [];
    const boardId = live.meta.origin.boardId ?? 'main';
    const dir = projectBoardsDir(live.ctx.project.dataKey, boardId);
    // The card is already saved by the time this runs, so a failed broadcast must not fail the tool: the agent would retry and add it again.
    const publish = async (card: Card) => { try {
        emit(live, { type: 'board_op', boardId, op: { card } });
    }
    catch (e) {
        console.error('board_op broadcast failed', e);
    } return JSON.stringify(card); };
    const op = operations(publish);
    return [
        tool('canvas_read', DESCRIPTIONS.read, shapes.read, a => op.read(dir, a)),
        tool('canvas_add_card', DESCRIPTIONS.addCard, shapes.addCard, a => op.addCard(dir, a)),
        tool('canvas_add_image', DESCRIPTIONS.addImage, shapes.addImage, a => op.addImage(dir, a)),
        tool('canvas_add_chart', DESCRIPTIONS.addChart, shapes.addChart, a => op.addChart(dir, a)),
        tool('canvas_edit_chart', DESCRIPTIONS.editChart, shapes.editChart, a => op.editChart(dir, a)),
        tool('canvas_edit_card', DESCRIPTIONS.editCard, shapes.editCard, a => op.editCard(dir, a)),
        tool('canvas_comment', 'Comment on quoted text.', { card_id: z.string(), quote: z.string(), body: z.string().max(20000), kind: z.enum(['change','question','side_chat','inline']).optional() }, a => lock(dir, async () => { const c = await readCard(dir, a.card_id); c.comments.push({ id: crypto.randomUUID(), body: a.body, quote: a.quote, resolved: false, replies: [], author: 'agent', sentAt: new Date().toISOString(), detached: !c.markdown.includes(a.quote) }); return publish(await saveCard(dir, c)); })),
        tool('canvas_reply', 'Reply to a comment or image pin.', { card_id: z.string(), target_id: z.string(), body: z.string().max(20000), resolve: z.boolean().optional() }, a => lock(dir, async () => { const c = await readCard(dir, a.card_id), t = c.comments.find(t => t.id === a.target_id); if (!t)
            throw new Error('Thread not found'); t.replies.push({ id: crypto.randomUUID(), author: 'agent', body: a.body, sentAt: new Date().toISOString() }); if (a.resolve !== undefined)
            t.resolved = a.resolve; return publish(await saveCard(dir, c)); })),
    ];
}

/** Sessions that get `canvasTools`: everything except a canvas's own agent (which has `boardTools`) and the top chief, which only routes. */
export const hasCanvasTools = (live: Pick<LiveSession, 'meta'>) => live.meta.origin?.kind !== 'board' && live.meta.origin?.kind !== 'top_chief';

/**
 * Canvas tools for any other session in the project: workers (including a relayed thought's first pass), scouts, chiefs and
 * chats. They create canvases and write to one named by `canvas_id`; an open board picks the change up live.
 */
export function canvasTools(live: Pick<LiveSession, 'meta' | 'ctx'>) {
    if (!hasCanvasTools(live))
        return [];
    const project = live.ctx.project;
    /** The existing canvas named by `canvas_id`; only `main` may be created implicitly, as the board page does. */
    async function canvasDir(canvasId: string) {
        if (!validId(canvasId))
            throw new Error('Invalid canvas_id; use canvas_list or canvas_create');
        const dir = projectBoardsDir(project.dataKey, canvasId);
        if (canvasId !== 'main')
            await stat(path.join(dir, 'board.json')).catch(() => { throw new Error(`Canvas ${canvasId} not found; use canvas_list or canvas_create`); });
        return dir;
    }
    const target = { canvas_id: z.string().max(80).describe('Canvas id from canvas_create or canvas_list; "main" is the project\'s main canvas.') };
    function targeted<S extends z.ZodRawShape>(name: string, description: string, schema: S, run: (dir: string, args: Args<S>, canvasId: string) => Promise<string>) {
        const full = { ...target, ...schema } as typeof target & S;
        return tool(name, description, full, async (a) => { const { canvas_id, ...rest } = a as { canvas_id: string } & Args<S>; return run(await canvasDir(canvas_id), rest as unknown as Args<S>, canvas_id); });
    }
    const forCanvas = (canvasId: string) => operations(async (card) => {
        // As with the board agent, the card is saved: a failed broadcast must not make the agent add it again.
        try {
            emitBoardChange({ projectId: project.id, boardId: canvasId, cardId: card.id });
        }
        catch (e) {
            console.error('canvas change broadcast failed', e);
        }
        return JSON.stringify({ ...card, contentJson: undefined, canvas_id: canvasId, path: canvasPath(project, canvasId, card.id) });
    });
    return [
        tool('canvas_list', 'List the project\'s canvases: id, name and path.', {}, async () => JSON.stringify((await listCanvases(project.dataKey)).map(c => ({ id: c.id, name: c.name, path: canvasPath(project, c.id) })))),
        tool('canvas_create', 'Create a new, empty canvas in this project and return its id and path. Use it when the person asks for a canvas or board of your work.', { name: z.string().trim().min(1).max(200) }, async ({ name }) => { const created = await createCanvas(project.dataKey, name); return JSON.stringify({ id: created.id, name: created.name, path: canvasPath(project, created.id) }); }),
        targeted('canvas_read', DESCRIPTIONS.read, shapes.read, (dir, a, id) => forCanvas(id).read(dir, a)),
        targeted('canvas_add_card', 'Add a markdown text card (900px wide by default). Without source_card_id it is placed clear of existing cards.', shapes.addCard, (dir, a, id) => forCanvas(id).addCard(dir, a)),
        targeted('canvas_add_image', DESCRIPTIONS.addImage, shapes.addImage, (dir, a, id) => forCanvas(id).addImage(dir, a)),
        targeted('canvas_add_chart', DESCRIPTIONS.addChart, shapes.addChart, (dir, a, id) => forCanvas(id).addChart(dir, a)),
        targeted('canvas_edit_chart', DESCRIPTIONS.editChart, shapes.editChart, (dir, a, id) => forCanvas(id).editChart(dir, a)),
        targeted('canvas_edit_card', DESCRIPTIONS.editCard, shapes.editCard, (dir, a, id) => forCanvas(id).editCard(dir, a)),
    ];
}
