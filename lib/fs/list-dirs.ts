import "server-only";
import { existsSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HttpError } from "@/lib/api/errors";

export type DirEntry = { name: string; path: string; git: boolean };
export type DirListing = { path: string; parent: string | null; home: string; entries: DirEntry[] };

/** Resolve a user-typed path (absolute, `~` or `~/x`) against the home dir. */
export function expandPath(input: string, home = os.homedir()) {
  const trimmed = input.trim() || "~";
  return path.resolve(home, trimmed.replace(/^~(?=$|\/)/, home));
}

const inside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * The subfolders of `input`, for the in-browser folder picker. Limited to the home dir so a remote
 * client can browse its own code but not the whole host. Hidden folders are left out.
 */
export async function listDirs(input: string, home = os.homedir()): Promise<DirListing> {
  const root = await realpath(home);
  let dir: string;
  try {
    dir = await realpath(expandPath(input, home));
  } catch {
    throw new HttpError(404, "That folder doesn't exist");
  }
  if (!inside(root, dir)) throw new HttpError(403, "Only folders inside your home folder can be browsed");
  const dirents = await readdir(dir, { withFileTypes: true }).catch(() => {
    throw new HttpError(403, "That folder can't be read");
  });
  const entries = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => {
      const full = path.join(dir, d.name);
      return { name: d.name, path: full, git: existsSync(path.join(full, ".git")) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { path: dir, parent: dir === root ? null : path.dirname(dir), home: root, entries };
}
