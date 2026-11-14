'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { editorExtensions } from '@/lib/editor/extensions';
import { docToMarkdown } from '@/lib/editor/markdown';
import { registerEditor } from '@/lib/editor/registry';
import { MENTION, agentMention } from '@/lib/board/agent-mention';
import { BoardDocToolbar } from './board-doc-toolbar';
import type { Card } from '@/lib/board/types';
export function BoardDocEditor({ card, label, onChange, onComment, onMention, onFocus, onBlur }: {
    card: Card;
    label: string;
    onChange: (p: Partial<Card>) => void;
    onComment: (quote: string, id: string) => void;
    onMention: (quote: string, id: string) => void;
    onFocus?: () => void;
    /** Called with whether the document is empty when the editor loses focus. */
    onBlur?: (empty: boolean) => void;
}) {
    const [mentionExtension] = useState(() => agentMention(onMention));
    const handlers = useRef({ onFocus, onBlur });
    useEffect(() => { handlers.current = { onFocus, onBlur }; });
    const extensions = useMemo(() => [...editorExtensions({ placeholder: `Write a plan or ask ${MENTION}…` }), mentionExtension], [mentionExtension]);
    const editor = useEditor({ extensions, immediatelyRender: false, content: card.contentJson ?? card.markdown, contentType: card.contentJson ? 'json' : 'markdown', editorProps: { attributes: { class: 'outline-none min-h-6', 'aria-label': label } }, onUpdate: ({ editor }) => onChange({ markdown: docToMarkdown(editor), contentJson: editor.getJSON() }), onFocus: () => handlers.current.onFocus?.(), onBlur: ({ editor }) => handlers.current.onBlur?.(editor.isEmpty) });
    useEffect(() => { if (editor)
        return registerEditor(card.id, editor); }, [editor, card.id]);
    useEffect(() => { editor?.setOptions({ editorProps: { attributes: { class: 'outline-none min-h-6', 'aria-label': label } } }); }, [editor, label]);
    useEffect(() => { if (editor && docToMarkdown(editor) !== card.markdown)
        editor.commands.setContent(card.contentJson ?? card.markdown, { contentType: card.contentJson ? 'json' : 'markdown', emitUpdate: false }); }, [editor, card.markdown, card.contentJson]);
    return <div className="doc-prose"><EditorContent editor={editor}/>{editor && <BoardDocToolbar editor={editor} onComment={() => { const id = crypto.randomUUID(); const quote = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' '); editor.chain().focus().setComment(id).run(); onComment(quote, id); }}/>}</div>;
}
