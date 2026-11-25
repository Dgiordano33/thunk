import 'server-only';
import { getSession } from '@/lib/agent';
import { listCanvases } from './service';
import { canvasStatus } from './status';
import type { Board } from './types';

/** The board agent's status, from the live session registry; a session that isn't live is idle. */
function agentStatus(board: Board) {
    const live = board.agent ? getSession(board.agent.sessionId) : undefined;
    if (!live || live.driver.isClosed) return 'idle' as const;
    return canvasStatus(live.meta, [...live.pending.values()].filter(p => p.routedTo !== 'chief').length);
}

/** A project's canvases with what each one's agent is doing now. */
export const listCanvasesWithStatus = (key: string) => listCanvases(key, agentStatus);
