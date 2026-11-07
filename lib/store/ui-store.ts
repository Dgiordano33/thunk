"use client";

import { create } from "zustand";

/** View state that outlives a single session page (it survives switching session tabs). */
export const useUi = create<{
  commentsOpen: boolean;
  setCommentsOpen: (open: boolean) => void;
}>((set) => ({
  commentsOpen: false,
  setCommentsOpen: (commentsOpen) => set({ commentsOpen }),
}));
