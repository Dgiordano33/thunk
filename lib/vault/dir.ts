import "server-only";
import { projectVaultDir } from "@/lib/projects/paths";
import type { Project } from "@/lib/projects/types";
import type { VaultDir } from "./store";

/** A project's vault on disk. Kept dependency-light so agent session setup can import it. */
export const vaultDirOf = (project: Pick<Project, "id" | "dataKey">): VaultDir => ({ projectId: project.id, dir: projectVaultDir(project.dataKey) });
