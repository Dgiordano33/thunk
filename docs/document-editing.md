# Document editing

Canvas text cards, notes, and editable assistant responses share document controls.

- Type `/` at the start of a paragraph to insert or change a block. Filter by typing, choose with the arrow keys and Enter, or dismiss with Escape.
- **Insert / Turn into** offers text, headings, lists, checklists, quotes, code, dividers, tables, callouts, toggles, media, references, and a table of contents.
- **Block** moves, duplicates, deletes, or copies a link to the current top-level block. The grip drags that block. Duplicates receive fresh reference targets when linked.
- **Table actions** adds and removes rows/columns, toggles headers, and merges/splits selected cells. Drag column boundaries to resize. Select multiple cells before merging.
- **Format** applies basic formatting, semantic text colors, or highlights. **Clear color** removes the color mark.
- Callouts contain editable blocks. Toggles collapse their content; **Toggle title** edits their label. Use **Unwrap callout or toggle** to return its content to the document.
- Image, file, and embed blocks accept HTTP(S) URLs and descriptive titles. Image titles supply alt text. File blocks link to the file. Embeds are sandboxed with scripts disabled; some sites refuse embedding.
- References accept a page/block URL or a heading in the current document. **Copy block link** creates a durable target; Canvas links include the card ID. A table of contents follows the document's headings as they change.

## Storage and agent edits

Ordinary prose remains Markdown. Rich tables and blocks use fenced `thunk-block-v1` JSON nodes so widths, merged cells, nested content, colors, and reference IDs survive file-backed note saves and agent edits. These blocks are rendered as editable content in Thunk. Other Markdown readers display their structured source.

Agents should preserve the fence, node type, attributes, and unrelated content when changing a rich block. Text replacements inside these fences must preserve valid JSON escaping. Comment marks are stored separately and are not serialized into the fences.

Columns, database views, and synced reusable blocks are outside this feature. Media uploads and cross-document backlink indexing are not included; media uses URLs and references use links.
