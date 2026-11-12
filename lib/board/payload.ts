import { escapeXml as xml, ensureNl } from '@/lib/revisions/build-payload';
import { createTwoFilesPatch } from 'diff';
import { pendingOf, type Scope } from './pending';
import type { Snapshot } from './types';
export function payload(state: Snapshot, scope?: Scope) {
    const pending = pendingOf(state.board, state.cards, scope);
    return `<canvas_update mode="${scope ? 'mention' : 'batch'}">\n${pending.cards.map(c => `<card id="${c.id}" kind="${c.kind}">\n${!scope ? xml(createTwoFilesPatch('before', 'after', ensureNl(c.baselineMarkdown), ensureNl(c.markdown))) : ''}\n<document>${xml(c.markdown.slice(0, 40000))}</document>\n<threads>${xml(JSON.stringify(c.comments.filter(t => !scope || t.id === scope.targetId)))}</threads>\n${c.asset ? `<image>${xml(c.asset)}</image><strokes>${xml(JSON.stringify(c.strokes))}</strokes>` : ''}\n</card>`).join('\n')}\n<deleted>${pending.tombstones.join(', ')}</deleted>\n</canvas_update>`;
}
