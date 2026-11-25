"use client";

import type { WorkspaceDelivery } from "@/lib/projects/delivery-types";
import { create } from "zustand";
import type { ActivitySession, CanvasActivity } from "@/lib/ambient/types";
import type { RoutineRunActivity } from "@/lib/routines/types";

export const useAmbient = create<{
  sessions: ActivitySession[];
  deliveries: WorkspaceDelivery[];
  /** Routine runs open or finished in the last few minutes. */
  runs: RoutineRunActivity[];
  /** Canvas agents that are live, with what they're doing. */
  canvases: CanvasActivity[];
  error: string | null;
  /** Desktop alerts opt-in, persisted to localStorage by the settings menu. */
  notifications: boolean;
}>(() => ({ sessions: [], deliveries: [], runs: [], canvases: [], error: null, notifications: false }));
