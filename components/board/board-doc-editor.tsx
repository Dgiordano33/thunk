'use client';
import { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { editorExtensions } from '@/lib/editor/extensions';
import { docToMarkdown } from '@/lib/editor/markdown';
import { registerEditor } from '@/lib/editor/registry';
import { agentMention } from '@/lib/board/agent-mention';
import { BoardDocToolbar } from './board-doc-toolbar';
import type { Card } from '@/lib/board/types';
export function BoardDocEditor({ card, onChange, onComment, onMention }: {
    card: Card;
    onChange: (p: Partial<Card>) => void;
    onComment: (quote: string, id: string) => void;
    onMention: (quote: string, id: string) => void;
}) {
    const [mentionExtension] = useState(() => agentMention(onMention));
    const extensions = useMemo(() => [...editorExtensions({ placeholder: 'Write a plan or ask @agent…' }), mentionExtension], [mentionExtension]);
    const editor = useEditor({ extensions, immediatelyRender: false, content: card.contentJson ?? card.markdown, contentType: card.contentJson ? 'json' : 'markdown', editorProps: { attributes: { class: 'outline-none min-h-24', 'aria-label': card.title } }, onUpdate: ({ editor }) => onChange({ markdown: docToMarkdown(editor), contentJson: editor.getJSON() }) });
    useEffect(() => { if (editor)
        return registerEditor(card.id, editor); }, [editor, card.id]);
    useEffect(() => { if (editor && docToMarkdown(editor) !== card.markdown)
        editor.commands.setContent(card.contentJson ?? card.markdown, { contentType: card.contentJson ? 'json' : 'markdown', emitUpdate: false }); }, [editor, card.markdown, card.contentJson]);
    return <div className="doc-prose"><EditorContent editor={editor}/>{editor && <BoardDocToolbar editor={editor} onComment={() => { const id = crypto.randomUUID(); const quote = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' '); editor.chain().focus().setComment(id).run(); onComment(quote, id); }}/>}</div>;
}
