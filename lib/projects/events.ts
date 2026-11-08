import { EventEmitter } from "node:events";

// Process-wide project events. Only depends on node:events so runtime.ts stays testable with a bare transpile hook.

export type RunFailedEvent = { projectId: string; workspaceId: string; exitCode: number; tail: string };

type ProjectEventMap = { run_failed: [RunFailedEvent]; setup_failed: [RunFailedEvent] };

const g = globalThis as typeof globalThis & { __thunkProjectEvents?: EventEmitter<ProjectEventMap> };

export function projectEvents(): EventEmitter<ProjectEventMap> {
  return (g.__thunkProjectEvents ??= new EventEmitter<ProjectEventMap>());
}
