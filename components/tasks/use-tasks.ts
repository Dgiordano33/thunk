"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { api } from "@/lib/client/api";
import type { TaskCounts, TaskTree } from "@/lib/tasks/types";

const useTasksFeed = create<{ rev: number; touch: () => void }>((set) => ({
  rev: 0,
  touch: () => set((s) => ({ rev: s.rev + 1 })),
}));
export const refreshTasks = () => useTasksFeed.getState().touch();
let source: EventSource | null = null;
let refs = 0;

export function useTasksEvents() {
  useEffect(() => {
    refs++;
    if (!source) {
      source = new EventSource("/api/tasks/events");
      source.onmessage = refreshTasks;
      // Reconnects may have missed writes while the connection was down.
      source.onopen = refreshTasks;
    }
    return () => {
      if (--refs === 0) { source?.close(); source = null; }
    };
  }, []);
}

export function useScopeTasks({ projectId, workspaceId }: { projectId: string; workspaceId?: string }) {
  useTasksEvents();
  const rev = useTasksFeed((s) => s.rev);
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
