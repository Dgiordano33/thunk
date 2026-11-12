import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
export function agentMention(onMention: (quote: string, id: string) => void) {
    return Extension.create({ name: 'agentMention', addProseMirrorPlugins() {
            return [new Plugin({ props: { handleKeyDown(view, event) {
                            if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey)
                                return false;
                            const { $from } = view.state.selection, text = $from.parent.textContent;
                            if (!text.includes('@agent'))
                                return false;
                            const id = crypto.randomUUID(), mark = view.state.schema.marks.comment;
                            if (mark)
                                view.dispatch(view.state.tr.addMark($from.start(), $from.end(), mark.create({ commentId: id })));
                            onMention(text, id);
                            return false;
                        } } })];
        } });
}
