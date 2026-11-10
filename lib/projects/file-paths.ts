// Path rules for the workspace file browser. Shared between server and client: keep free of server-only imports.

/**
 * A browser-supplied path relative to a workspace root, normalised to `a/b/c` ("" for the root itself).
 * Returns null for anything that could leave the root (absolute paths, `..`) or that touches `.git`.
 */
export function cleanRelativePath(input: string): string | null {
  if (input.includes("\0") || input.startsWith("/") || input.startsWith("\\") || /^[a-zA-Z]:/.test(input)) return null;
  const parts: string[] = [];
  for (const part of input.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === ".." || part === ".git") return null;
    parts.push(part);
  }
  return parts.join("/");
}

/** True when `target` is `root` or inside it. Both must be absolute, resolved paths. */
export function isWithin(root: string, target: string) {
  const base = root.endsWith("/") ? root : `${root}/`;
  return target === root || target.startsWith(base);
}

/** The last path segment, for tab labels and titles. */
export function fileName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}
