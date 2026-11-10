// What the create-project wizard and "Add repo" send. Shared between server and client: keep free of server-only imports.
import { z } from "zod";

const label = z.string().trim().max(80).optional();

export const RepoSpec = z.discriminatedUnion("source", [
  z.object({ source: z.literal("existing"), path: z.string().min(1, "path is required"), name: label }),
  z.object({
    source: z.literal("github"),
    url: z.string().min(1, "url is required"),
    parent: z.string().min(1, "parent folder is required"),
    name: label,
  }),
  z.object({
    source: z.literal("new"),
    parent: z.string().min(1, "parent folder is required"),
    folder: z.string().min(1, "folder name is required"),
    git: z.boolean().optional(),
    name: label,
  }),
]);
export type RepoSpec = z.infer<typeof RepoSpec>;

export const CreateProjectBody = z.object({
  name: z.string().trim().min(1, "name is required").max(80),
  repos: z.array(RepoSpec).max(20, "A project can start with at most 20 repos"),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

export type RepoResult<Repo> =
  | { index: number; status: "added"; repo: Repo }
  | { index: number; status: "failed"; error: string };

export { repoNameFromUrl } from "./repo-name";
