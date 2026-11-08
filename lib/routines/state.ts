import "server-only";

/** A run this process is driving. `cancel` stops it whichever stage it's in. */
export type ActiveRun = { runId: string; routineId: string; sessionId: string | null; cancel: (reason: string) => void };

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  tickCount: number;
  booted: boolean;
  /** Reassigned on every module load so the interval and listeners always call fresh code after HMR. */
  tick: () => Promise<void>;
  onRunFailed: (event: import("@/lib/projects/events").RunFailedEvent) => void;
  listenersBound: boolean;
  /** Keyed by routine id: one active run per routine. */
  active: Map<string, ActiveRun>;
  /** Last automatic firing per routine and source, for debounce/rate limits. */
  lastFired: Map<string, number>;
};

// Pinned to globalThis so HMR module reloads keep the timer and in-flight runs.
const g = globalThis as typeof globalThis & { __thunkRoutines?: SchedulerState };

export const routinesState: SchedulerState = (g.__thunkRoutines ??= {
  timer: null,
  ticking: false,
  tickCount: 0,
  booted: false,
  tick: async () => {},
  onRunFailed: () => {},
  listenersBound: false,
  active: new Map(),
  lastFired: new Map(),
});
