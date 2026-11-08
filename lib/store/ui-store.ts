"use client";

import { create } from "zustand";
import type { Theme } from "@/lib/theme";

/** View state that outlives a single session page (it survives switching session tabs). */
export const useUi = create<{
  commentsOpen: boolean;
  setCommentsOpen: (open: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>((set) => ({
  commentsOpen: false,
  setCommentsOpen: (commentsOpen) => set({ commentsOpen }),
  theme: "system",
  setTheme: (theme) => {
    try { localStorage.setItem("thunk.theme", theme); } catch { /* Storage is optional. */ }
    set({ theme });
  },
}));
