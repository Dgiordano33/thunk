import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const Config = z.object({
  // `test` is what an integration check runs after trial-merging worker branches.
  scripts: z.object({ setup: z.string().optional(), run: z.string().optional(), archive: z.string().optional(), test: z.string().optional() }).default({}),
  notebooks: z.array(z.string().min(1)).optional(),
  filesToCopy: z.array(z.string().min(1)).optional(),
});
export type LifecycleConfig = z.infer<typeof Config>;

/** Read commands only from the registered root, never an agent-edited worktree. */
export async function readLifecycleConfig(root: string): Promise<LifecycleConfig> {
  for (const name of ["thunk.json", "conductor.json"]) {
    const source = await readFile(path.join(root, name), "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (source !== null) return Config.parse(JSON.parse(source));
  }
  return Config.parse({});
}

export async function copyWorkspaceFiles(root: string, cwd: string, config: LifecycleConfig) {
  if (root === cwd) return;
  const files = config.filesToCopy ?? (await readdir(root)).filter((file) => file.startsWith(".env"));
  const realRoot = await realpath(root);
  const realCwd = await realpath(cwd);
  for (const file of files) {
    const parts = file.split(/[\\/]/);
    if (path.isAbsolute(file) || parts.some((part) => !part || part === "." || part === ".." || part === ".git")) {
      throw new Error(`Unsafe filesToCopy path: ${file}`);
    }
    const source = path.join(root, file);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`filesToCopy must name regular files: ${file}`);
    const resolved = await realpath(source);
    if (!resolved.startsWith(realRoot + path.sep)) throw new Error(`File is outside the project: ${file}`);
    let destination = cwd;
    for (const part of parts.slice(0, -1)) {
      destination = path.join(destination, part);
      await mkdir(destination, { recursive: true });
      if (!(await realpath(destination)).startsWith(realCwd + path.sep)) throw new Error(`Copy destination escapes workspace: ${file}`);
    }
    await copyFile(source, path.join(cwd, file), constants.COPYFILE_EXCL).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err;
    });
  }
}
