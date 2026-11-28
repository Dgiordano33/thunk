'use client';
/* eslint-disable @next/next/no-img-element -- User supplied media URLs are rendered directly. */
import { useMemo, createElement, Fragment, type ReactNode } from 'react';
import type { JSONContent } from '@tiptap/core';
import { Streamdown } from 'streamdown';
import { MarkdownManager } from '@tiptap/markdown';
import { schemaExtensions } from '@/lib/editor/extensions';
import { safeMediaUrl } from '@/lib/editor/rich-blocks';
function render(node: JSONContent, key: number): ReactNode {
  const a = node.attrs ?? {}, children = node.content?.map(render);
  if (node.type === 'text') return <Fragment key={key}>{(node.marks ?? []).reduce<ReactNode>((child, mark) => {
    const attrs = mark.attrs ?? {};
    if (mark.type === 'link') return <a href={/^(https?:|mailto:|[/#])/i.test(attrs.href ?? '') ? attrs.href : undefined}>{child}</a>;
    if (mark.type === 'ink') return <span data-ink={attrs.tone} data-highlight={attrs.highlight ? '' : undefined}>{child}</span>;
    const tag = ({ bold: 'strong', italic: 'em', strike: 's', code: 'code', underline: 'u' } as Record<string, string>)[mark.type];
    return tag ? createElement(tag, {}, child) : child;
  }, node.text)}</Fragment>;
  if (node.type === 'media') return <figure key={key} id={a.blockId}>{a.kind === 'image' ? <img src={safeMediaUrl(a.src) || undefined} alt={a.title}/> : <a href={safeMediaUrl(a.src)}>{a.title || a.src}</a>}<figcaption>{a.title}</figcaption></figure>;
  if (node.type === 'inlineImage') return <img key={key} src={safeMediaUrl(a.src) || undefined} alt={a.title}/>;
  if (node.type === 'tableOfContents') return <nav key={key} aria-label="Table of contents">Table of contents</nav>;
  if (node.type === 'richBlock') return a.kind === 'toggle' ? <details key={key} open id={a.blockId}><summary>{a.title}</summary>{children}</details> : <aside key={key} id={a.blockId} className="editor-callout">{children}</aside>;
  if (node.type === 'table') return <table key={key} id={a.blockId}><tbody>{children}</tbody></table>;
  const tag = node.type === 'heading' ? `h${Math.max(1, Math.min(6, a.level))}` : ({ paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', taskList: 'ul', taskItem: 'li', blockquote: 'blockquote', codeBlock: 'pre', table: 'table', tableRow: 'tr', tableCell: 'td', tableHeader: 'th', horizontalRule: 'hr', hardBreak: 'br' } as Record<string, string>)[node.type ?? ''];
  return createElement(tag || 'div', { key, id: a.blockId, ...(node.type === 'tableCell' || node.type === 'tableHeader' ? { colSpan: a.colspan, rowSpan: a.rowspan } : {}) }, node.type === 'horizontalRule' || node.type === 'hardBreak' ? undefined : children);
}
/** Keep zoomed-out Canvas cards readable without mounting a ProseMirror editor for every card. */
export function RichPreview({ markdown }: { markdown: string }) {
  const rich = markdown.includes('thunk-block-v1');
  const doc = useMemo(() => rich ? new MarkdownManager({ extensions: schemaExtensions() }).parse(markdown) : null, [markdown, rich]);
  return doc ? <>{doc.content?.map(render)}</> : <Streamdown>{markdown}</Streamdown>;
}
