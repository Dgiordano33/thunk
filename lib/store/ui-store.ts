"use client";

import { create } from "zustand";
import type { Theme } from "@/lib/theme";

/** View state that outlives a single session page (it survives switching session tabs). */
export const useUi = create<{
  commentsOpen: boolean;
  setCommentsOpen: (open: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Home-map toolbar: expanded into the Projects/Notes/Routines panel or collapsed to the orb. */
  hudExpanded: boolean;
  setHudExpanded: (expanded: boolean) => void;
}>((set) => ({
  commentsOpen: false,
  setCommentsOpen: (commentsOpen) => set({ commentsOpen }),
  theme: "system",
  setTheme: (theme) => {
    try { localStorage.setItem("thunk.theme", theme); } catch { /* Storage is optional. */ }
    set({ theme });
  },
  hudExpanded: false,
  setHudExpanded: (hudExpanded) => {
    try { localStorage.setItem("thunk.hud.expanded", hudExpanded ? "on" : "off"); } catch { /* Storage is optional. */ }
    set({ hudExpanded });
  },
}));
