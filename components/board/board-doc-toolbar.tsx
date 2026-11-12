'use client';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { BoldIcon, CodeIcon, Heading1Icon, Heading2Icon, ItalicIcon, LinkIcon, ListChecksIcon, ListIcon, ListOrderedIcon, MessageSquarePlusIcon, StrikethroughIcon, TextQuoteIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

type Action = { label: string; icon: LucideIcon; active: (e: Editor) => boolean; run: (e: Editor) => void };

const marks: Action[] = [
    { label: 'Bold', icon: BoldIcon, active: e => e.isActive('bold'), run: e => e.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: ItalicIcon, active: e => e.isActive('italic'), run: e => e.chain().focus().toggleItalic().run() },
    { label: 'Strikethrough', icon: StrikethroughIcon, active: e => e.isActive('strike'), run: e => e.chain().focus().toggleStrike().run() },
    { label: 'Inline code', icon: CodeIcon, active: e => e.isActive('code'), run: e => e.chain().focus().toggleCode().run() },
    { label: 'Link', icon: LinkIcon, active: e => e.isActive('link'), run: e => {
        if (e.isActive('link')) return void e.chain().focus().extendMarkRange('link').unsetLink().run();
        const href = window.prompt('Link URL');
        if (href) e.chain().focus().extendMarkRange('link').setLink({ href }).run();
    } },
];

const blocks: Action[] = [
    { label: 'Heading 1', icon: Heading1Icon, active: e => e.isActive('heading', { level: 1 }), run: e => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', icon: Heading2Icon, active: e => e.isActive('heading', { level: 2 }), run: e => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Bulleted list', icon: ListIcon, active: e => e.isActive('bulletList'), run: e => e.chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', icon: ListOrderedIcon, active: e => e.isActive('orderedList'), run: e => e.chain().focus().toggleOrderedList().run() },
    { label: 'Checklist', icon: ListChecksIcon, active: e => e.isActive('taskList'), run: e => e.chain().focus().toggleTaskList().run() },
    { label: 'Quote', icon: TextQuoteIcon, active: e => e.isActive('blockquote'), run: e => e.chain().focus().toggleBlockquote().run() },
];

/** Floating formatting toolbar shown over a text selection in a canvas doc. */
export function BoardDocToolbar({ editor, onComment }: { editor: Editor; onComment: () => void }) {
    // Re-render on selection/transaction changes so active states stay in sync.
    const active = useEditorState({ editor, selector: ({ editor }) => [...marks, ...blocks].map(a => a.active(editor)) });
    const render = (list: Action[], offset: number) => list.map((a, i) => <Button key={a.label} size="icon-sm" variant={active[offset + i] ? 'secondary' : 'ghost'} aria-label={a.label} aria-pressed={active[offset + i]} title={a.label} onMouseDown={e => e.preventDefault()} onClick={() => a.run(editor)}><a.icon /></Button>);
    return <BubbleMenu editor={editor} options={{ placement: 'top', offset: 8, strategy: 'fixed' }} appendTo={() => document.body} shouldShow={({ editor, state }) => editor.isEditable && !state.selection.empty} className="z-50 flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
      {render(marks, 0)}
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      {render(blocks, marks.length)}
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      <Button size="sm" variant="ghost" onMouseDown={e => e.preventDefault()} onClick={onComment}><MessageSquarePlusIcon />Comment</Button>
    </BubbleMenu>;
}
