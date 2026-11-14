import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
/** Typing this in a paragraph (then Enter) or a comment sends that card's thread to the canvas agent right away. */
export const MENTION = '@thunk';
export const mentions = (text: string) => /@thunk\b/i.test(text);
export function agentMention(onMention: (quote: string, id: string) => void) {
    return Extension.create({ name: 'agentMention', addProseMirrorPlugins() {
            return [new Plugin({ props: { handleKeyDown(view, event) {
                            if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey)
                                return false;
                            const { $from } = view.state.selection, text = $from.parent.textContent;
                            if (!mentions(text))
                                return false;
                            const id = crypto.randomUUID(), mark = view.state.schema.marks.comment;
                            if (mark)
                                view.dispatch(view.state.tr.addMark($from.start(), $from.end(), mark.create({ commentId: id })));
                            onMention(text, id);
                            return false;
                        } } })];
        } });
}
