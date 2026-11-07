"use client";

import { create } from "zustand";
import type { ActivitySession } from "@/lib/ambient/types";

export const useAmbient = create<{
  sessions: ActivitySession[];
  error: string | null;
  /** Desktop alerts opt-in, persisted to localStorage by the settings menu. */
  notifications: boolean;
  usageOpen: boolean;
}>(() => ({ sessions: [], error: null, notifications: false, usageOpen: false }));
