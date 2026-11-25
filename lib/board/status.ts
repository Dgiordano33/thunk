import type { CanvasStatus } from './types';

/** A canvas agent's status from its live session: `pending` counts requests waiting on the person. Shared by server and client. */
export function canvasStatus(meta: { status: string; waitingOn?: string | null } | null | undefined, pending = 0): CanvasStatus {
    if (!meta) return 'idle';
    if (pending > 0 || (meta.status === 'awaiting' && meta.waitingOn !== 'chief')) return 'waiting';
    return meta.status === 'running' || meta.status === 'starting' ? 'running' : 'idle';
}

export const CANVAS_STATUS_LABEL: Record<CanvasStatus, string> = { idle: 'Idle', running: 'Agent working', waiting: 'Waiting on you' };
