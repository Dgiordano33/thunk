"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { subscribeAppEvents } from "@/lib/client/app-events";
import { api } from "@/lib/client/api";
import type { TaskCounts, TaskTree } from "@/lib/tasks/types";

// `rev` moves on every change, `all` on refreshes with no project, `projects` per project.
const useTasksFeed = create<{ rev: number; all: number; projects: Record<string, number>; touch: (projectId?: string) => void }>((set) => ({
  rev: 0,
  all: 0,
  projects: {},
  touch: (projectId) => set((s) => ({
    rev: s.rev + 1,
    all: projectId ? s.all : s.all + 1,
    projects: projectId ? { ...s.projects, [projectId]: (s.projects[projectId] ?? 0) + 1 } : s.projects,
  })),
}));
export const refreshTasks = () => useTasksFeed.getState().touch();
let unsubscribe: (() => void) | null = null;
let refs = 0;

export function useTasksEvents() {
  useEffect(() => {
    refs++;
    unsubscribe ??= subscribeAppEvents("tasks", {
      onEvent: (event) => useTasksFeed.getState().touch(event.projectId),
      // Reconnects may have missed writes while the connection was down.
      onOpen: refreshTasks,
    });
    return () => { if (--refs === 0) { unsubscribe?.(); unsubscribe = null; } };
  }, []);
}

export function useScopeTasks({ projectId, workspaceId }: { projectId: string; workspaceId?: string }) {
  useTasksEvents();
  const rev = useTasksFeed((s) => s.all + (s.projects[projectId] ?? 0));
  const [state, setState] = useState<{ projectId: string; tree: TaskTree | null; error: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.taskTree(projectId)
      .then(({ tree }) => !cancelled && setState({ projectId, tree, error: null }))
      .catch((err: Error) => !cancelled && setState((s) => ({ projectId, tree: s?.projectId === projectId ? s.tree : null, error: err.message })));
    return () => { cancelled = true; };
  }, [projectId, rev]);
  const current = state?.projectId === projectId ? state : null;
  return {
    tree: current?.tree ?? null,
    tasks: current?.tree?.workspaces.find((w) => w.workspace.id === workspaceId)?.tasks ?? [],
    projectTasks: current?.tree?.tasks ?? [],
    error: current?.error ?? null,
    reload: refreshTasks,
  };
}

export function useTaskCounts() {
  useTasksEvents();
  const rev = useTasksFeed((s) => s.rev);
  const [counts, setCounts] = useState<TaskCounts>({});
  useEffect(() => {
    let cancelled = false;
    api.taskCounts().then((r) => !cancelled && setCounts(r.counts)).catch((err) => console.error("[thunk] task counts", err));
    return () => { cancelled = true; };
  }, [rev]);
  return counts;
}
