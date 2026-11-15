'use client';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEffect, useState } from 'react';
import { BoldIcon, CodeIcon, Heading1Icon, Heading2Icon, ItalicIcon, LinkIcon, ListChecksIcon, ListIcon, ListOrderedIcon, MessageSquarePlusIcon, StrikethroughIcon, TextQuoteIcon, XIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { normalizeLink } from '@/lib/editor/link';

/** The bubble menu's plugin key, to ask it to re-measure. */
const MENU = 'boardDocMenu';

type Action = { label: string; icon: LucideIcon; active: (e: Editor) => boolean; run: (e: Editor) => void };

const marks: Action[] = [
    { label: 'Bold', icon: BoldIcon, active: e => e.isActive('bold'), run: e => e.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: ItalicIcon, active: e => e.isActive('italic'), run: e => e.chain().focus().toggleItalic().run() },
    { label: 'Strikethrough', icon: StrikethroughIcon, active: e => e.isActive('strike'), run: e => e.chain().focus().toggleStrike().run() },
    { label: 'Inline code', icon: CodeIcon, active: e => e.isActive('code'), run: e => e.chain().focus().toggleCode().run() },
    // Link opens the URL field below instead of running here.
    { label: 'Link', icon: LinkIcon, active: e => e.isActive('link'), run: () => {} },
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
    // The URL being typed while the toolbar edits a link, or null. The field lives inside the bubble menu, so focus
    // moving to it doesn't hide the menu, and the editor keeps its selection for when the link is applied.
    const [link, setLink] = useState<string | null>(null), [error, setError] = useState('');
    useEffect(() => {
        const reset = () => { setLink(null); setError(''); };
        editor.on('selectionUpdate', reset);
        return () => { editor.off('selectionUpdate', reset); };
    }, [editor]);
    // The menu keeps the position it had for the full toolbar; re-center it when it switches to or from the field.
    const editing = link !== null;
    useEffect(() => { editor.view.dispatch(editor.state.tr.setMeta(MENU, 'updatePosition')); }, [editor, editing]);
    const close = () => { setLink(null); setError(''); editor.commands.focus(); };
    const apply = () => {
        const next = normalizeLink(link ?? '');
        if ('error' in next) return setError(next.error);
        const chain = editor.chain().focus().extendMarkRange('link');
        if ('remove' in next) chain.unsetLink().run();
        else chain.setLink({ href: next.href }).run();
        setLink(null);
        setError('');
    };
    const run = (a: Action) => a.label === 'Link' ? (setLink(editor.getAttributes('link').href ?? ''), setError('')) : a.run(editor);
    const render = (list: Action[], offset: number) => list.map((a, i) => <Button key={a.label} size="icon-sm" variant={active[offset + i] ? 'secondary' : 'ghost'} aria-label={a.label} aria-pressed={active[offset + i]} title={a.label} onMouseDown={e => e.preventDefault()} onClick={() => run(a)}><a.icon /></Button>);
    return <BubbleMenu editor={editor} pluginKey={MENU} options={{ placement: 'top', offset: 8, strategy: 'fixed' }} appendTo={() => document.body} shouldShow={({ editor, state }) => editor.isEditable && !state.selection.empty} className="z-50 flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
      {link === null ? <>
        {render(marks, 0)}
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        {render(blocks, marks.length)}
        <Separator orientation="vertical" className="mx-0.5 h-5" />
        <Button size="sm" variant="ghost" onMouseDown={e => e.preventDefault()} onClick={onComment}><MessageSquarePlusIcon />Comment</Button>
      </> : <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); apply(); }}>
        <LinkIcon aria-hidden="true" className="ml-1 size-4 shrink-0 text-muted-foreground" />
        <Input autoFocus value={link} onChange={e => { setLink(e.target.value); setError(''); }} aria-label="Link URL" aria-invalid={!!error} aria-describedby={error ? 'board-link-error' : undefined} placeholder="Paste or type a link" className="h-7 w-64 text-sm"
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }} />
        <Button type="submit" size="sm">Apply</Button>
        {active[marks.findIndex(m => m.label === 'Link')] && <Button type="button" size="sm" variant="ghost" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLink(null); }}>Remove</Button>}
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={close}><XIcon /></Button>
        {error && <p id="board-link-error" role="alert" className="px-1 text-xs text-destructive">{error}</p>}
      </form>}
    </BubbleMenu>;
}
