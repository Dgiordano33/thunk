"use client";

import { createContext, useContext } from "react";

/** The open workspace's page URL, `/{project}/{workspace}`. Set by the workspace shell. */
const WorkspaceBase = createContext<string | null>(null);

export const WorkspaceBaseProvider = WorkspaceBase.Provider;

export function useWorkspaceBase() {
  const base = useContext(WorkspaceBase);
  if (!base) throw new Error("useWorkspaceBase must be used inside the workspace shell");
  return base;
}
