import { Extension, Mark, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { BulletList, OrderedList, TaskList } from '@tiptap/extension-list';
import Blockquote from '@tiptap/extension-blockquote';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import { Table } from '@tiptap/extension-table';

/** Rich blocks use an explicit, versioned Markdown fence so file-backed notes and agent edits are lossless. */
export function richMarkdown(node: JSONContent) {
  const clean = (n: JSONContent): JSONContent => ({ ...n, ...(n.marks ? { marks: n.marks.filter(m => m.type !== 'comment') } : {}), ...(n.content ? { content: n.content.map(clean) } : {}) });
  const json = JSON.stringify(clean(node), null, 2);
  const fence = '`'.repeat(Math.max(3, ...Array.from(json.matchAll(/`+/g), m => m[0].length + 1)));
  return `${fence}thunk-block-v1\n${json}\n${fence}`;
}
const supported = new Set(['paragraph', 'heading', 'table', 'richBlock', 'media', 'tableOfContents', 'bulletList', 'orderedList', 'taskList', 'blockquote']);
const blockTypes = new Set([...supported, 'codeBlock', 'horizontalRule']);
const inlineTypes = new Set(['text', 'hardBreak']);
/** Refuse malformed JSON blocks before they reach the editor schema. */
function validNode(value: unknown, depth = 0): value is JSONContent {
  if (!value || typeof value !== 'object' || depth > 64) return false;
  const n = value as JSONContent;
  if (typeof n.type !== 'string') return false;
  if (n.type === 'text') return typeof n.text === 'string' && n.text.length > 0 && (!n.marks || Array.isArray(n.marks) && n.marks.every(m => ['bold', 'italic', 'strike', 'underline', 'code', 'link', 'ink'].includes(m.type)));
  if (['hardBreak', 'horizontalRule', 'media', 'tableOfContents'].includes(n.type)) return !n.content?.length;
  const children = n.content ?? [];
  if (!Array.isArray(children) || !children.every(c => validNode(c, depth + 1))) return false;
  if (['paragraph', 'heading'].includes(n.type)) return children.every(c => inlineTypes.has(c.type!));
  if (n.type === 'codeBlock') return children.every(c => c.type === 'text');
  if (n.type === 'table') return children.length > 0 && children.every(c => c.type === 'tableRow');
  if (n.type === 'tableRow') return children.length > 0 && children.every(c => c.type === 'tableCell' || c.type === 'tableHeader');
  if (['bulletList', 'orderedList', 'taskList'].includes(n.type)) return children.length > 0 && children.every(c => c.type === (n.type === 'taskList' ? 'taskItem' : 'listItem'));
  if (['listItem', 'taskItem'].includes(n.type) && children[0]?.type !== 'paragraph') return false;
  if (['richBlock', 'blockquote', 'listItem', 'taskItem', 'tableCell', 'tableHeader'].includes(n.type)) return children.length > 0 && children.every(c => blockTypes.has(c.type!));
  return false;
}
export const RichMarkdown = Extension.create({
  name: 'richMarkdown',
  markdownTokenName: 'thunkBlock',
  markdownTokenizer: {
    name: 'thunkBlock', level: 'block', start: src => src.search(/`{3,}thunk-block-v1\n/),
    tokenize(src) {
      const match = /^(`{3,})thunk-block-v1\n([\s\S]*?)\n\1(?:\n|$)/.exec(src);
      if (!match) return;
      try {
        const node = JSON.parse(match[2]);
        if (!node || !supported.has(node.type) || !validNode(node)) return;
        return { type: 'thunkBlock', raw: match[0], node };
      } catch { return; }
    },
  },
  parseMarkdown: token => token.node as JSONContent,
});
const needsRich = (node: JSONContent): boolean => ['table', 'richBlock', 'media', 'tableOfContents'].includes(node.type ?? '') || !!node.attrs?.blockId || !!node.marks?.some(m => m.type === 'ink') || !!node.content?.some(needsRich);
export const RichBulletList = BulletList.extend({ renderMarkdown(n, h, c) { return needsRich(n) ? richMarkdown(n) : this.parent?.(n, h, c) ?? ''; } });
export const RichOrderedList = OrderedList.extend({ renderMarkdown(n, h, c) { return needsRich(n) ? richMarkdown(n) : this.parent?.(n, h, c) ?? ''; } });
export const RichTaskList = TaskList.extend({ renderMarkdown(n, h, c) { return needsRich(n) ? richMarkdown(n) : this.parent?.(n, h, c) ?? ''; } });
export const RichBlockquote = Blockquote.extend({ renderMarkdown(n, h, c) { return needsRich(n) ? richMarkdown(n) : this.parent?.(n, h, c) ?? ''; } });
export const RichParagraph = Paragraph.extend({ renderMarkdown(n, h, c) { return needsRich(n) ? richMarkdown(n) : this.parent?.(n, h, c) ?? ''; } });
export const RichHeading = Heading.extend({ renderMarkdown: (n, h) => needsRich(n) ? richMarkdown(n) : `${'#'.repeat(n.attrs?.level ?? 1)} ${h.renderChildren(n.content ?? [])}` });
export const RichTable = Table.extend({ renderMarkdown: richMarkdown });
export const BlockIds = Extension.create({
  name: 'blockIds',
  addGlobalAttributes: () => [{ types: ['paragraph', 'heading', 'richBlock', 'media', 'table', 'tableOfContents'], attributes: { blockId: { default: null, parseHTML: el => el.getAttribute('id'), renderHTML: attrs => attrs.blockId ? { id: attrs.blockId } : {} } } }],
});
export const INKS = ['default', 'muted', 'accent', 'important'] as const;
export const Ink = Mark.create({
  name: 'ink',
  addAttributes: () => ({ tone: { default: 'accent' }, highlight: { default: false } }),
  parseHTML: () => [{ tag: 'span[data-ink]', getAttrs: el => ({ tone: el.getAttribute('data-ink'), highlight: el.hasAttribute('data-highlight') }) }],
  renderHTML: ({ HTMLAttributes: a }) => ['span', { 'data-ink': INKS.includes(a.tone) ? a.tone : 'default', ...(a.highlight ? { 'data-highlight': '' } : {}) }, 0],
});
export function safeMediaUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export const RichBlock = Node.create({
  name: 'richBlock', group: 'block', content: 'block+', defining: true,
  addAttributes: () => ({ kind: { default: 'callout' }, title: { default: 'Details' } }),
  parseHTML: () => [{ tag: 'aside[data-callout]' }, { tag: 'details', getAttrs: el => ({ kind: 'toggle', title: el.querySelector('summary')?.textContent ?? 'Details' }), contentElement: '[data-toggle-content]' }],
  renderHTML: ({ node, HTMLAttributes }) => node.attrs.kind === 'toggle'
    ? ['details', mergeAttributes(HTMLAttributes, { open: true }), ['summary', {}, node.attrs.title], ['div', { 'data-toggle-content': '' }, 0]]
    : ['aside', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'editor-callout' }), 0],
  renderMarkdown: richMarkdown,
  addNodeView() { return ({ node }) => {
    const dom = document.createElement(node.attrs.kind === 'toggle' ? 'details' : 'aside');
    if (node.attrs.blockId) dom.id = node.attrs.blockId;
    if (node.attrs.kind === 'toggle') { dom.setAttribute('open', ''); const summary = document.createElement('summary'); summary.textContent = node.attrs.title; summary.contentEditable = 'false'; dom.append(summary); }
    else dom.className = 'editor-callout';
    const contentDOM = document.createElement('div'); dom.append(contentDOM);
    return { dom, contentDOM, ignoreMutation: mutation => mutation.type === 'attributes' && mutation.target === dom, stopEvent: event => event.target instanceof HTMLElement && event.target.closest('summary') !== null };
  }; },
});
export const Media = Node.create({
  markdownTokenName: 'image',
  parseMarkdown: token => ({ type: 'media', attrs: { kind: 'image', src: safeMediaUrl(token.href), title: token.text || token.title || '' } }),
  name: 'media', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ kind: { default: 'image' }, src: { default: '' }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'figure[data-media]', getAttrs: el => ({ kind: el.getAttribute('data-media'), src: el.getAttribute('data-src'), title: el.getAttribute('data-title') }) }, { tag: 'img[src]', getAttrs: el => ({ kind: 'image', src: el.getAttribute('src'), title: el.getAttribute('alt') ?? '' }) }],
  renderHTML: ({ node }) => {
    const { kind, title, blockId } = node.attrs, src = safeMediaUrl(node.attrs.src);
    const child = kind === 'image' ? ['img', { src, alt: title, loading: 'lazy' }] : kind === 'embed' ? ['iframe', { src, title: title || 'Embedded content', sandbox: '', referrerpolicy: 'no-referrer', loading: 'lazy' }] : ['a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, title || src];
    return ['figure', { 'data-media': kind, 'data-src': src, 'data-title': title, id: blockId }, child, ['figcaption', {}, title]] as import('@tiptap/pm/model').DOMOutputSpec;
  },
  renderMarkdown: richMarkdown,
});
export const TableOfContents = Node.create({
  name: 'tableOfContents', group: 'block', atom: true,
  parseHTML: () => [{ tag: 'nav[data-toc]' }],
  renderHTML: () => ['nav', { 'data-toc': '', 'aria-label': 'Table of contents' }, 'Table of contents'],
  renderMarkdown: richMarkdown,
  addNodeView() { return ({ editor }) => {
    const dom = document.createElement('nav'); dom.setAttribute('aria-label', 'Table of contents'); dom.contentEditable = 'false'; dom.className = 'editor-toc';
    const update = () => { dom.replaceChildren(); editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = node.textContent || 'Untitled heading'; button.style.paddingLeft = `${(node.attrs.level - 1) * 12}px`;
      button.onclick = () => { editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run(); }; dom.append(button);
    }); if (!dom.childNodes.length) dom.textContent = 'Add headings to build a table of contents.'; };
    update(); editor.on('update', update); return { dom, destroy: () => { editor.off('update', update); } };
  }; },
});
