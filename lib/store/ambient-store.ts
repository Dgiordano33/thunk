"use client";

import type { WorkspaceDelivery } from "@/lib/projects/delivery-types";
import { create } from "zustand";
import type { ActivitySession } from "@/lib/ambient/types";
import type { RoutineRunActivity } from "@/lib/routines/types";

export const useAmbient = create<{
  sessions: ActivitySession[];
  deliveries: WorkspaceDelivery[];
  /** Routine runs open or finished in the last few minutes. */
  runs: RoutineRunActivity[];
  error: string | null;
  /** Desktop alerts opt-in, persisted to localStorage by the settings menu. */
  notifications: boolean;
  usageOpen: boolean;
}>(() => ({ sessions: [], deliveries: [], runs: [], error: null, notifications: false, usageOpen: false }));
