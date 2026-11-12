import type { BoardComment } from './types';
export const reanchor = (markdown: string, comments: BoardComment[]) => comments.map(c => ({ ...c, detached: !!c.quote && !markdown.includes(c.quote) }));
