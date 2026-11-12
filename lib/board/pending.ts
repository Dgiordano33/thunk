import type { Board, Card } from './types';
export type Scope = {
    cardId: string;
    targetId: string;
};
export function pendingOf(board: Board, cards: Card[], scope?: Scope) {
    return { cards: cards.filter(c => (!scope || c.id === scope.cardId) && ((!scope && (c.markdown !== c.baselineMarkdown || c.kind === 'image' && !c.sentAt || c.strokes.some(s => !s.sentAt))) || c.comments.some(t => (!scope || t.id === scope.targetId) && (!t.sentAt || t.replies.some(r => !r.sentAt))))), tombstones: scope ? [] : board.tombstones };
}
