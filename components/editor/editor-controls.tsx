'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Editor } from '@tiptap/core';
import { NodeSelection, type SelectionBookmark } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { INKS, safeMediaUrl } from '@/lib/editor/rich-blocks';
import { normalizeLink } from '@/lib/editor/link';

type Action = { label: string; run: (editor: Editor) => void };
const blocks: Action[] = [
  { label: 'Text', run: e => { e.chain().focus().setParagraph().run(); } },
  ...([1, 2, 3] as const).map(level => ({ label: `Heading ${level}`, run: (e: Editor) => { e.chain().focus().setHeading({ level }).run(); } })),
  { label: 'Bulleted list', run: e => { e.chain().focus().toggleBulletList().run(); } },
  { label: 'Numbered list', run: e => { e.chain().focus().toggleOrderedList().run(); } },
  { label: 'Checklist', run: e => { e.chain().focus().toggleTaskList().run(); } },
  { label: 'Quote', run: e => { e.chain().focus().toggleBlockquote().run(); } },
  { label: 'Code block', run: e => { e.chain().focus().toggleCodeBlock().run(); } },
  { label: 'Divider', run: e => { e.chain().focus().setHorizontalRule().run(); } },
  { label: 'Table', run: e => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  { label: 'Callout', run: e => { e.chain().focus().wrapIn('richBlock', { kind: 'callout' }).run(); } },
  { label: 'Toggle', run: e => { e.chain().focus().wrapIn('richBlock', { kind: 'toggle', title: 'Details' }).run(); } },
  { label: 'Table of contents', run: e => { e.chain().focus().insertContent({ type: 'tableOfContents' }).run(); } },
];
const tables: Action[] = [
  { label: 'Row above', run: e => { e.chain().focus().addRowBefore().run(); } },
  { label: 'Row below', run: e => { e.chain().focus().addRowAfter().run(); } },
  { label: 'Column before', run: e => { e.chain().focus().addColumnBefore().run(); } },
  { label: 'Column after', run: e => { e.chain().focus().addColumnAfter().run(); } },
  { label: 'Header row', run: e => { e.chain().focus().toggleHeaderRow().run(); } },
  { label: 'Header column', run: e => { e.chain().focus().toggleHeaderColumn().run(); } },
  { label: 'Merge cells', run: e => { e.chain().focus().mergeCells().run(); } },
  { label: 'Split cell', run: e => { e.chain().focus().splitCell().run(); } },
  { label: 'Delete row', run: e => { e.chain().focus().deleteRow().run(); } },
  { label: 'Delete column', run: e => { e.chain().focus().deleteColumn().run(); } },
  { label: 'Delete table', run: e => { e.chain().focus().deleteTable().run(); } },
];
function currentBlock(editor: Editor) {
  const { $from } = editor.state.selection;
  const index = $from.index(0), node = editor.state.doc.child(index);
  return { index, node, from: $from.depth ? $from.before(1) : $from.pos };
}
function changeBlock(editor: Editor, action: 'up' | 'down' | 'duplicate' | 'delete') {
  const { node, from, index } = currentBlock(editor), tr = editor.state.tr;
  if (action === 'duplicate') {
    // Duplicates must never inherit link targets.
    const json = node.toJSON();
    const clear = (n: typeof json) => { if (n.attrs) delete n.attrs.blockId; n.content?.forEach(clear); }; clear(json);
    tr.insert(from + node.nodeSize, editor.schema.nodeFromJSON(json));
  } else if (action === 'delete') tr.delete(from, from + node.nodeSize);
  else {
    if (action === 'up' && index === 0 || action === 'down' && index === editor.state.doc.childCount - 1) return;
    const target = action === 'up' ? from - editor.state.doc.child(index - 1).nodeSize : from + editor.state.doc.child(index + 1).nodeSize;
    tr.delete(from, from + node.nodeSize).insert(target, node);
    tr.setSelection(NodeSelection.create(tr.doc, target));
  }
  editor.view.dispatch(tr); editor.commands.focus();
}
function Menu({ label, actions, editor }: { label: string; actions: Action[]; editor: Editor }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button size="xs" variant="ghost">{label}</Button></DropdownMenuTrigger><DropdownMenuContent onCloseAutoFocus={e => e.preventDefault()}>{actions.map(a => <DropdownMenuItem key={a.label} onSelect={() => a.run(editor)}>{a.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}
/** Shared controls: keyboard slash menu, block actions, and richer document editing. */
export function EditorControls({ editor, cardId }: { editor: Editor; cardId?: string }) {
  const state = useEditorState({ editor, selector: ({ editor: e }) => {
    const { $from, empty } = e.state.selection;
    const prefix = $from.parent.isTextblock ? $from.parent.textBetween(0, $from.parentOffset, '', '\ufffc') : '';
    const slash = empty && /^\/[\w ]*$/.test(prefix) ? { query: prefix.slice(1).toLowerCase(), from: $from.start(), to: $from.pos } : null;
    const headings: { title: string; pos: number; id: string | null }[] = [];
    e.state.doc.descendants((n, pos) => { if (n.type.name === 'heading') headings.push({ title: n.textContent, pos, id: n.attrs.blockId }); });
    return { slash, table: e.isActive('table'), toggle: e.isActive('richBlock', { kind: 'toggle' }), headings, selection: e.state.selection.from };
  } });
  const [form, setForm] = useState<string | null>(null), [url, setUrl] = useState(''), [title, setTitle] = useState('');
  const [dismissed, setDismissed] = useState<string | null>(null), [index, setIndex] = useState(0);
  const range = useRef<SelectionBookmark | null>(null);
  const openForm = (kind: string) => { range.current = editor.state.selection.getBookmark(); setUrl(''); setTitle(kind === 'Toggle title' ? editor.getAttributes('richBlock').title : ''); setForm(kind); };
  const choices: Action[] = [...blocks, ...['Image', 'File', 'Embed', 'Reference'].map(label => ({ label, run: () => openForm(label) }))];
  const matches = choices.filter(a => a.label.toLowerCase().includes(state.slash?.query ?? ''));
  const slashKey = state.slash ? `${state.slash.from}:${state.slash.query}` : '';
  const showSlash = !!state.slash && dismissed !== slashKey && editor.isFocused;
  const choose = (a: Action) => { if (state.slash) editor.chain().focus().deleteRange(state.slash).run(); a.run(editor); setIndex(0); };
  const latest = useRef({ showSlash, matches, index, choose, slashKey });
  useEffect(() => { latest.current = { showSlash, matches, index, choose, slashKey }; });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const s = latest.current; if (!s.showSlash) return;
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
      if (e.key === 'Escape') setDismissed(s.slashKey);
      if (e.key === 'ArrowDown') setIndex(i => (i + 1) % Math.max(1, s.matches.length));
      if (e.key === 'ArrowUp') setIndex(i => (i + s.matches.length - 1) % Math.max(1, s.matches.length));
      if (e.key === 'Enter' && s.matches.length) s.choose(s.matches[s.index % s.matches.length]);
    };
    const dom = editor.view.dom; dom.addEventListener('keydown', key, true); return () => dom.removeEventListener('keydown', key, true);
  }, [editor]);
  useEffect(() => {
    const follow = () => { const id = window.location.hash.slice(1); if (!id) return; editor.state.doc.descendants((node, pos) => { if (node.attrs.blockId === id) editor.chain().setTextSelection(pos + (node.isTextblock ? 1 : 0)).scrollIntoView().run(); }); };
    follow(); window.addEventListener('hashchange', follow); return () => window.removeEventListener('hashchange', follow);
  }, [editor]);
  const copyLink = async () => {
    const { node, from } = currentBlock(editor);
    if (!('blockId' in node.attrs)) { toast.error('Choose a paragraph, heading, table, callout, or media block.'); return; }
    const id = node.attrs.blockId || `block-${crypto.randomUUID()}`;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(from, undefined, { ...node.attrs, blockId: id }));
    const link = new URL(window.location.href); link.hash = id; if (cardId) link.searchParams.set('card', cardId);
    try { await navigator.clipboard.writeText(link.href); toast.success('Block link copied'); } catch { toast.error('Could not copy the link'); }
  };
  const addReference = (pos: number) => {
    const node = editor.state.doc.nodeAt(pos); if (!node) return;
    const id = node.attrs.blockId || `block-${crypto.randomUUID()}`;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id }));
    if (range.current) editor.view.dispatch(editor.state.tr.setSelection(range.current.resolve(editor.state.doc)));
    editor.chain().focus().insertContent({ type: 'text', text: node.textContent || 'Section', marks: [{ type: 'link', attrs: { href: `#${id}` } }] }).run(); setForm(null);
  };
  const position = showSlash ? editor.view.coordsAtPos(editor.state.selection.from) : null;
  return <div className="editor-controls not-prose" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setForm(null); editor.commands.focus(); } }}>
    <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Document editing">
      <Button size="xs" variant="ghost" draggable aria-label="Drag current block" onDragStart={e => {
        const { from } = currentBlock(editor); const selection = NodeSelection.create(editor.state.doc, from); editor.view.dispatch(editor.state.tr.setSelection(selection));
        // ProseMirror exposes dragging as mutable integration state.
        // eslint-disable-next-line react-hooks/immutability
        editor.view.dragging = { slice: selection.content(), move: true }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', selection.node.textContent);
      }}>⠿</Button>
      <Menu label="Insert / Turn into" actions={choices} editor={editor}/>
      <Menu label="Block" editor={editor} actions={[
        ...(['up', 'down', 'duplicate', 'delete'] as const).map(action => ({ label: ({ up: 'Move up', down: 'Move down', duplicate: 'Duplicate', delete: 'Delete block' })[action], run: () => changeBlock(editor, action) })),
        { label: 'Copy block link', run: () => { void copyLink(); } },
        { label: 'Unwrap callout or toggle', run: e => { e.chain().focus().lift('richBlock').run(); } },
      ]}/>
      {state.table && <Menu label="Table actions" actions={tables} editor={editor}/>}
      <Menu label="Format" editor={editor} actions={[
        { label: 'Bold', run: e => { e.chain().focus().toggleBold().run(); } },
        { label: 'Italic', run: e => { e.chain().focus().toggleItalic().run(); } },
        { label: 'Strikethrough', run: e => { e.chain().focus().toggleStrike().run(); } },
        { label: 'Inline code', run: e => { e.chain().focus().toggleCode().run(); } },
        ...INKS.flatMap(tone => [false, true].map(highlight => ({ label: `${highlight ? 'Highlight' : 'Text'}: ${tone}`, run: (e: Editor) => { e.chain().focus().setMark('ink', { tone, highlight }).run(); } }))),
        { label: 'Clear color', run: e => { e.chain().focus().unsetMark('ink').run(); } },
        { label: 'Open reference', run: e => {
          const href = e.getAttributes('link').href;
          if (typeof href !== 'string') { toast.error('Place the cursor in a link first'); return; }
          if (href.startsWith('#')) {
            e.state.doc.descendants((node, pos) => { if (node.attrs.blockId === href.slice(1)) e.chain().focus().setTextSelection(pos + (node.isTextblock ? 1 : 0)).scrollIntoView().run(); });
          } else {
            const link = normalizeLink(href); if ('href' in link) window.open(link.href, '_blank', 'noopener,noreferrer');
          }
        } },
      ]}/>
      {state.toggle && <Button size="xs" variant="ghost" onClick={() => openForm('Toggle title')}>Toggle title</Button>}
    </div>
    {form && <form className="my-2 flex flex-wrap items-center gap-2 rounded-md border bg-popover p-2" onSubmit={e => {
      e.preventDefault(); if (range.current) editor.view.dispatch(editor.state.tr.setSelection(range.current.resolve(editor.state.doc)));
      if (form === 'Toggle title') editor.chain().focus().updateAttributes('richBlock', { title }).run();
      else if (form === 'Reference') {
        const link = normalizeLink(url); if (!('href' in link)) { toast.error('Enter a page or block URL'); return; }
        editor.chain().focus().insertContent({ type: 'text', text: title || url, marks: [{ type: 'link', attrs: { href: link.href } }] }).run();
      } else {
        const src = safeMediaUrl(url); if (!src) { toast.error('Enter an http or https URL'); return; }
        const node = { type: 'media', attrs: { kind: form.toLowerCase(), src, title } };
        if (editor.state.selection instanceof NodeSelection) editor.chain().focus().insertContentAt(editor.state.selection.to, node).run();
        else editor.chain().focus().insertContent(node).run();
      }
      setForm(null);
    }}>
      <span className="text-xs font-medium">{form}</span>
      {form !== 'Toggle title' && <Input autoFocus aria-label={`${form} URL`} placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} className="w-56"/>}
      <Input autoFocus={form === 'Toggle title'} aria-label={`${form} title`} placeholder={form === 'Image' ? 'Description / alt text' : 'Title'} value={title} onChange={e => setTitle(e.target.value)} className="w-48"/>
      <Button size="sm" type="submit">Apply</Button><Button size="sm" variant="ghost" type="button" onClick={() => { setForm(null); editor.commands.focus(); }}>Cancel</Button>
      {form === 'Reference' && <div className="flex w-full flex-wrap gap-1">{state.headings.map(h => <Button key={h.pos} type="button" size="xs" variant="outline" onClick={() => addReference(h.pos)}>{h.title || 'Untitled heading'}</Button>)}</div>}
      {form === 'Embed' && <p className="w-full text-xs text-muted-foreground">Some sites block embedding. Embedded content runs with scripts disabled.</p>}
    </form>}
    {showSlash && position && createPortal(<div role="listbox" aria-label="Insert block" className="fixed z-50 max-h-72 w-56 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md" style={{ left: Math.max(8, Math.min(position.left, window.innerWidth - 232)), top: Math.max(8, Math.min(position.bottom + 4, window.innerHeight - 296)) }}>
      {matches.length ? matches.map((a, i) => <button type="button" role="option" aria-selected={i === index % matches.length} key={a.label} className={`block w-full rounded px-2 py-1 text-left text-sm ${i === index % matches.length ? 'bg-accent text-accent-foreground' : ''}`} onMouseDown={e => e.preventDefault()} onClick={() => choose(a)}>{a.label}</button>) : <p className="p-2 text-sm">No matching blocks</p>}
    </div>, document.body)}
  </div>;
}
