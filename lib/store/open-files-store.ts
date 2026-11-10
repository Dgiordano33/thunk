"use client";

import { create } from "zustand";

export type OpenFile = { workspaceId: string; root: string; path: string };

/** Unsaved editor content, kept across tab switches so leaving a file doesn't lose edits. */
export type Draft = { content: string; baseVersion: string };

const STORAGE_KEY = "thunk.openFiles";

export const fileKey = (f: Omit<OpenFile, "workspaceId"> & { workspaceId?: string }) => `${f.workspaceId ?? ""}:${f.root}:${f.path}`;

function load(): OpenFile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((f) => f && typeof f.path === "string") : [];
  } catch {
    return [];
  }
}

function save(files: OpenFile[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(files)); } catch { /* Storage is optional. */ }
}

/** Files opened as tabs beside a workspace's sessions, plus their unsaved drafts. Tabs persist; drafts live in memory. */
export const useOpenFiles = create<{
  hydrated: boolean;
  files: OpenFile[];
  drafts: Record<string, Draft>;
  /** Directories expanded in the file tree, by `workspaceId:root:dir`. */
  expanded: Record<string, true>;
  hydrate: () => void;
  open: (file: OpenFile) => void;
  close: (file: OpenFile) => void;
  setDraft: (file: OpenFile, draft: Draft | null) => void;
  toggleDir: (key: string, open?: boolean) => void;
}>((set, get) => ({
  hydrated: false,
  files: [],
  drafts: {},
  expanded: {},
  hydrate: () => {
    if (!get().hydrated) set({ hydrated: true, files: load() });
  },
  open: (file) => {
    const { files } = get();
    if (files.some((f) => fileKey(f) === fileKey(file))) return;
    const next = [...files, file];
    save(next);
    set({ files: next });
  },
  close: (file) => {
    const key = fileKey(file);
    const next = get().files.filter((f) => fileKey(f) !== key);
    save(next);
    const drafts = { ...get().drafts };
    delete drafts[key];
    set({ files: next, drafts });
  },
  setDraft: (file, draft) => {
    const key = fileKey(file);
    const drafts = { ...get().drafts };
    if (draft) drafts[key] = draft;
    else delete drafts[key];
    set({ drafts });
  },
  toggleDir: (key, open) => {
    const expanded = { ...get().expanded };
    if (open ?? !expanded[key]) expanded[key] = true;
    else delete expanded[key];
    set({ expanded });
  },
}));
