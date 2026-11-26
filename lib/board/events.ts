import { EventEmitter } from "node:events";

/**
 * Process-wide canvas changes made outside a canvas's own agent session (a worker or chat writing to it), so an open
 * board picks them up live. The board's own agent still reports through its session stream as `board_op`.
 */
export type BoardChange = { projectId: string; boardId: string; cardId: string };

const g = globalThis as typeof globalThis & { __thunkBoardEvents?: EventEmitter };
const events = (g.__thunkBoardEvents ??= new EventEmitter().setMaxListeners(0));

export function emitBoardChange(change: BoardChange) { events.emit("change", change); }
export function subscribeBoardChanges(listener: (change: BoardChange) => void) {
    events.on("change", listener);
    return () => { events.off("change", listener); };
}
