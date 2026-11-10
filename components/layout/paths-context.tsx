"use client";

import { createContext, useContext, useMemo } from "react";
import { pathsFor } from "@/lib/routes";

type Tree = Parameters<typeof pathsFor>[0];

const Paths = createContext<ReturnType<typeof pathsFor>>(pathsFor([]));

/** Page URLs by project/workspace id, for components that only hold ids. Fed by the layout's project tree. */
export function PathsProvider({ projects, children }: { projects: Tree; children: React.ReactNode }) {
  const paths = useMemo(() => pathsFor(projects), [projects]);
  return <Paths.Provider value={paths}>{children}</Paths.Provider>;
}

export function usePaths() {
  return useContext(Paths);
}
