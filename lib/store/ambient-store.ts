"use client";

import { create } from "zustand";
import type { ActivitySession } from "@/lib/ambient/types";

export const useAmbient = create<{ sessions: ActivitySession[]; error: string | null }>(() => ({ sessions: [], error: null }));
