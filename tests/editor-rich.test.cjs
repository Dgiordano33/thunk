/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { MarkdownManager } = require('@tiptap/markdown');
const { schemaExtensions } = require('../lib/editor/extensions.ts');
const { safeMediaUrl } = require('../lib/editor/rich-blocks.ts');
const manager = () => new MarkdownManager({ extensions: schemaExtensions() });
const p = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
test('rich blocks round trip through markdown without losing content or attributes', () => {
 const m = manager();
 const nodes = [
  { type: 'richBlock', attrs: { kind: 'toggle', title: 'Why?' }, content: [p('Nested ``` text'), {type:'richBlock',attrs:{kind:'callout',title:'Note'},content:[p('A callout')]}] },
  { type: 'paragraph', attrs: { blockId: 'block-one' }, content: [{ type: 'text', text: 'Colored', marks: [{ type: 'ink', attrs: { tone: 'important', highlight: true } }] }] },
  { type: 'media', attrs: { kind: 'image', src: 'https://example.com/image.png', title: 'Alt text' } },
  { type: 'tableOfContents' },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, rowspan: 1, colwidth: [200, 300] }, content: [p('Header')] }] }] },
 ];
 for (const node of nodes) {
  const md = m.serialize({ type: 'doc', content: [node] });
  assert.deepEqual(m.parse(md).content[0], node);
  assert.equal(m.serialize(m.parse(md)), md);
 }
});
test('ordinary markdown stays ordinary and malformed rich fences remain code', () => {
 const m = manager();
 assert.match(m.serialize(m.parse('# Heading\n\nNormal **text**')), /^# Heading/);
 assert.equal(m.parse('```thunk-block-v1\nnot json\n```').content[0].type, 'codeBlock');
 assert.equal(m.parse('```thunk-block-v1\n{"type":"script"}\n```').content[0].type, 'codeBlock');
});
test('media rejects executable and local URL schemes', () => {
 for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a', '//example.com', '']) assert.equal(safeMediaUrl(url), '');
 assert.equal(safeMediaUrl('https://example.com/a'), 'https://example.com/a');
});
test('colored list paragraphs round trip and comments stay out of markdown', () => {
 const m = manager();
 const node = { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{type:'text',text:'Colored list',marks:[{type:'ink',attrs:{tone:'accent',highlight:false}}]}] }] }] };
 const md = m.serialize({type:'doc',content:[node]});
 assert.deepEqual(m.parse(md).content[0],node);
});
test('malformed known nodes fall back to code and ordinary image markdown imports', () => {
 const m = manager();
 assert.equal(m.parse('```thunk-block-v1\n{"type":"table","content":[{"type":"text","text":"bad"}]}\n```').content[0].type, 'codeBlock');
 assert.equal(m.parse('![Diagram](https://example.com/a.png)').content[0].type, 'media');
});
test('rich persistence strips comment marks without changing visible text', () => {
 const m = manager();
 const node = { type: 'richBlock', attrs: {kind:'callout'}, content: [{type:'paragraph',content:[{type:'text',text:'A quote',marks:[{type:'comment',attrs:{commentId:'private-thread'}}]}]}] };
 const md = m.serialize({type:'doc',content:[node]});
 assert.ok(!md.includes('private-thread'));
 assert.equal(m.parse(md).content[0].content[0].content[0].text, 'A quote');
});
test('images inside text stay inline and round trip as plain markdown', () => {
 const m = manager();
 const md = 'See ![a](https://x.com/a.png) here';
 const doc = m.parse(md);
 assert.equal(doc.content[0].type, 'paragraph');
 assert.equal(doc.content[0].content[1].type, 'inlineImage');
 assert.equal(m.serialize(doc), md);
 assert.equal(m.parse(m.serialize(m.parse('- item ![b](https://x.com/b.png)'))).content[0].type, 'bulletList');
});
test('relative image URLs survive a save', () => {
 const m = manager();
 assert.equal(m.serialize(m.parse('![diagram](./img.png)')), '![diagram](./img.png)');
 assert.equal(m.parse('![diagram](./img.png)').content[0].attrs.src, './img.png');
});
test('plain tables stay GFM; merged or sized tables use rich blocks', () => {
 const m = manager();
 const md = m.serialize(m.parse('| a | b |\n|---|---|\n| 1 | 2 |'));
 assert.ok(!md.includes('thunk-block-v1'));
 assert.match(md, /\| a +\| b +\|/);
 const merged = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [p('H')] }] }] };
 assert.match(m.serialize({ type: 'doc', content: [merged] }), /thunk-block-v1/);
});
test('checklists inside rich blocks still surface as note tasks and can be ticked', () => {
 const { extractTasks, setTaskDone } = require('../lib/notes/frontmatter.ts');
 const m = manager();
 const item = (text, checked) => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'ink', attrs: { tone: 'accent', highlight: false } }] }] }] });
 const body = `- [ ] plain\n\n${m.serialize({ type: 'doc', content: [{ type: 'taskList', content: [item('buy milk', false), item('eggs', true)] }] })}\n`;
 const tasks = extractTasks(body);
 assert.deepEqual(tasks.map(t => [t.text, t.done]), [['plain', false], ['buy milk', false], ['eggs', true]]);
 const ticked = setTaskDone(body, tasks[1].line, true);
 assert.deepEqual(extractTasks(ticked).map(t => t.done), [false, true, true]);
 assert.equal(m.parse(ticked).content[1].content[0].attrs.checked, true);
});
