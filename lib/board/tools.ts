import 'server-only';
import { z } from 'zod';
import path from 'node:path';
import type { LiveSession } from '@/lib/agent/session-registry';
import { projectBoardsDir } from '@/lib/projects/paths';
import { addCard, lock, readCard, saveCard, snapshot } from './store';
import { reanchor } from './anchors';
import type { Card } from './types';
export const BOARD_TOOL_NAMES = ['canvas_read', 'canvas_add_card', 'canvas_edit_card', 'canvas_reply', 'canvas_comment'];
export const boardPrompt = `You collaborate on the project's Canvas, a spatial board. Use canvas_read to inspect it and canvas_add_card, canvas_edit_card, canvas_comment and canvas_reply to deliver work. Answer every pending thread. Preserve user edits. Use source_card_id to connect responses. Images are available by absolute path with Read. Final prose is only a short activity summary; put substantive content on cards. AskUserQuestion is available for blocking questions.`;
export function boardTools(live: LiveSession) {
    if (live.meta.origin?.kind !== 'board')
        return [];
    const dir = projectBoardsDir(live.ctx.project.dataKey);
    const publish = async (card: Card) => { const { emit } = await import('@/lib/agent/session-registry'); emit(live, { type: 'board_op', boardId: 'main', op: { card } }); return JSON.stringify(card); };
    function tool<S extends z.ZodRawShape>(name: string, description: string, schema: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<string>) {
        return { name, description, schema, handler: async (input: unknown) => { try {
                return { content: [{ type: 'text' as const, text: await run(z.strictObject(schema).parse(input)) }] };
            }
            catch (e) {
                return { isError: true, content: [{ type: 'text' as const, text: String(e) }] };
            } } };
    }
    return [
        tool('canvas_read', 'Read Canvas cards and image paths.', { card_ids: z.array(z.string()).optional(), include_images: z.boolean().optional() }, async (a) => JSON.stringify((await snapshot(dir)).cards.map(c => ({ ...c, markdown: a.card_ids?.includes(c.id) ? c.markdown : c.markdown.slice(0, 300), asset: c.asset ? path.join(dir, 'assets', c.asset) : undefined })))),
        tool('canvas_add_card', 'Add a response card.', { markdown: z.string().max(100000), title: z.string().max(200).optional(), source_card_id: z.string().optional(), in_reply_to: z.string().optional(), width: z.number().min(240).max(2000).optional(), placement: z.enum(['right', 'below']).optional() }, a => lock(dir, async () => { const sourceId = a.source_card_id ?? (a.in_reply_to ? (await snapshot(dir)).cards.find(c => c.comments.some(t => t.id === a.in_reply_to))?.id : undefined); if(a.in_reply_to && !sourceId) throw new Error('Reply target not found'); return publish(await addCard(dir, { ...(a.width ? { width: a.width } : {}), title: a.title || 'Response', markdown: a.markdown, baselineMarkdown: a.markdown, author: 'agent', sentAt: new Date().toISOString() }, sourceId, a.placement)); })),
        tool('canvas_edit_card', 'Edit a card; exact old_string must occur once.', { card_id: z.string(), markdown: z.string().max(100000).optional(), edits: z.array(z.object({ old_string: z.string().min(1), new_string: z.string() })).optional(), summary: z.string().optional() }, a => lock(dir, async () => {
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
        })),
        tool('canvas_comment', 'Comment on quoted text.', { card_id: z.string(), quote: z.string(), body: z.string().max(20000), kind: z.enum(['change','question','side_chat','inline']).optional() }, a => lock(dir, async () => { const c = await readCard(dir, a.card_id); c.comments.push({ id: crypto.randomUUID(), body: a.body, quote: a.quote, resolved: false, replies: [], author: 'agent', sentAt: new Date().toISOString(), detached: !c.markdown.includes(a.quote) }); return publish(await saveCard(dir, c)); })),
        tool('canvas_reply', 'Reply to a comment or image pin.', { card_id: z.string(), target_id: z.string(), body: z.string().max(20000), resolve: z.boolean().optional() }, a => lock(dir, async () => { const c = await readCard(dir, a.card_id), t = c.comments.find(t => t.id === a.target_id); if (!t)
            throw new Error('Thread not found'); t.replies.push({ id: crypto.randomUUID(), author: 'agent', body: a.body, sentAt: new Date().toISOString() }); if (a.resolve !== undefined)
            t.resolved = a.resolve; return publish(await saveCard(dir, c)); })),
    ];
}
