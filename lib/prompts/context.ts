import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function projectCommands(root: string) {
  const dir = path.join(root, ".claude/commands");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch((err) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).replace(/\.md$/, "").split(path.sep).join(":"));
}

export async function promptContext(cwd: string, root: string) {
  let files: string[];
  try {
    const { stdout } = await promisify(execFile)("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, maxBuffer: 8 * 1024 * 1024 });
    files = [...new Set(stdout.split("\0").filter(Boolean))];
  } catch {
    files = [];
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile()) files.push(path.relative(cwd, file));
      }
    }
    await walk(cwd);
  }
  return { files: files.sort(), commands: await projectCommands(root) };
}

// shortcut: command templates support arguments only; use provider-native execution for shell hooks and command metadata.
export async function expandCommand(content: string, root: string) {
  const match = content.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match || !(await projectCommands(root)).includes(match[1])) return content;
  const dir = await realpath(path.join(root, ".claude/commands"));
  const file = await realpath(path.join(dir, `${match[1].split(":").join(path.sep)}.md`));
  if (!file.startsWith(dir + path.sep)) throw new Error("Command must be inside .claude/commands");
  const body = (await readFile(file, "utf8")).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const args = match[2] ?? "";
  const words = args.match(/"[^"]*"|'[^']*'|\S+/g)?.map((word) => word.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
  const expanded = body.replace(/\$ARGUMENTS|\$(\d+)/g, (_placeholder, index) => index ? (words[Number(index) - 1] ?? "") : args);
  return /\$ARGUMENTS|\$\d+/.test(body) ? expanded : `${body}\n${args}`;
}
