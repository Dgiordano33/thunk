/**
 * Shell allowlist for read-only sessions (chiefs and scouts). A command passes only if every segment
 * starts with a command known to read without writing; anything the parser can't vouch for is refused.
 * Pure and client-safe.
 */
export type ReadOnlyResult = { ok: true } | { ok: false; reason: string };

type Token = { op: string } | { word: string } | { redirect: string };

/** Redirections that only discard or merge output. Anything else that writes through `>` is refused. */
const SAFE_REDIRECT = /^(?:[0-9]?>>?\/dev\/null|[0-9]?>&[0-9]|&>>?\/dev\/null)$/;

function tokenize(command: string): Token[] | string {
  const tokens: Token[] = [];
  let word = "";
  let started = false;
  const push = () => { if (started) tokens.push({ word }); word = ""; started = false; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return "an unclosed quote";
      word += command.slice(i + 1, end); started = true; i = end; continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === "\\") { word += command[++j] ?? ""; continue; }
        if (command[j] === "`" || (command[j] === "$" && command[j + 1] === "(")) return "command substitution";
        word += command[j];
      }
      if (j >= command.length) return "an unclosed quote";
      started = true; i = j; continue;
    }
    if (c === "\\") { if (next !== "\n") { word += next ?? ""; started = true; } i++; continue; }
    if (c === "`" || (c === "$" && next === "(")) return "command substitution";
    if ((c === "<" || c === ">") && next === "(") return "process substitution";
    if (c === "(" || c === ")") return "a subshell";
    if (c === " " || c === "\t") { push(); continue; }
    if (c === "\n" || c === ";") { push(); tokens.push({ op: ";" }); continue; }
    if (c === "&" && next === "&") { push(); tokens.push({ op: "&&" }); i++; continue; }
    if (c === "|" && next === "|") { push(); tokens.push({ op: "||" }); i++; continue; }
    if (c === "|") { push(); tokens.push({ op: "|" }); if (next === "&") i++; continue; }
    if (c === ">" || c === "<" || (c === "&" && next === ">")) {
      // Fold a redirection into one token ("2>/dev/null", "2>&1", "&>/dev/null") so it can be checked whole.
      const fd = started && /^[0-9]$/.test(word) ? word : "";
      if (fd) { word = ""; started = false; } else push();
      let j = i;
      let op = command[j++];
      while (j < command.length && /[<>&|]/.test(command[j]) && op.length < 3) op += command[j++];
      while (command[j] === " " || command[j] === "\t") j++;
      let target = "";
      while (j < command.length && !/[\s;&|<>()]/.test(command[j])) target += command[j++];
      tokens.push({ redirect: `${fd}${op}${target}` });
      i = j - 1; continue;
    }
    if (c === "&") return "a background job";
    word += c; started = true;
  }
  push();
  return tokens;
}

const PLAIN = new Set(["ls", "cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "find", "stat", "file", "tree", "pwd", "which", "date", "jq", "sort", "uniq", "cut", "diff", "cd", "echo", "printf", "basename", "dirname", "realpath", "true", "nl", "du"]);
const GIT_READ = new Set(["status", "log", "diff", "show", "blame", "rev-parse", "ls-files", "branch", "worktree", "remote", "rev-list", "merge-base", "shortlog", "describe", "ls-tree", "cat-file", "grep", "reflog"]);
const GIT_BRANCH_FLAGS = new Set(["--list", "-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "--show-current", "--contains", "--no-contains", "--merged", "--no-merged", "--sort", "--format", "--no-color", "--color", "--points-at"]);
const GH_READ: Record<string, Set<string>> = {
  pr: new Set(["view", "list", "diff", "checks", "status"]),
  issue: new Set(["view", "list", "status"]),
  run: new Set(["view", "list"]),
  repo: new Set(["view"]),
};

function checkGit(args: string[]): string | null {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    const flag = args[i];
    if (flag === "-C") { i += 2; continue; }
    if (flag === "--no-pager" || flag === "-P" || flag === "--no-optional-locks") { i++; continue; }
    return `git ${flag} is not allowed`;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub || !GIT_READ.has(sub)) return `git ${sub ?? ""} changes the repository`.trim();
  if (rest.some((a) => a === "--output" || a.startsWith("--output=") || a === "-o" && sub !== "grep" && sub !== "rev-parse" || a === "--ext-diff" || a === "--textconv")) return `git ${sub} with an output file or external program`;
  if (sub === "branch") {
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j].split("=")[0];
      if (!GIT_BRANCH_FLAGS.has(a)) {
        // --list accepts patterns; --contains/--merged take a commit.
        const prev = rest[j - 1]?.split("=")[0];
        if (rest.includes("--list") || ["--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--sort", "--format"].includes(prev ?? "")) continue;
        return "git branch with arguments creates, renames or deletes branches";
      }
    }
  }
  if (sub === "worktree" && rest[0] !== "list") return "git worktree changes worktrees (only `git worktree list` is allowed)";
  if (sub === "remote" && rest.some((a) => a !== "-v" && a !== "--verbose") && rest[0] !== "show" && rest[0] !== "get-url") return "git remote changes remotes (only `git remote -v` is allowed)";
  if (sub === "reflog" && rest[0] && !["show", "-n", "--date"].some((p) => rest[0].startsWith(p)) && !rest[0].startsWith("-")) return "git reflog changes the reflog (only reading it is allowed)";
  return null;
}

function checkGh(args: string[]): string | null {
  const [group, action] = args;
  if (!group || !GH_READ[group]?.has(action ?? "")) return `gh ${[group, action].filter(Boolean).join(" ")} is not a read-only command`;
  return null;
}

function checkPlain(cmd: string, args: string[]): string | null {
  if (cmd === "find" && args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(a))) return "find with -delete, -exec or a file output";
  if (cmd === "sort" && args.some((a) => a === "-o" || a.startsWith("--output") || /^-[a-zA-Z]*o/.test(a))) return "sort -o writes a file";
  if (cmd === "tree" && args.some((a) => a === "-o")) return "tree -o writes a file";
  if (cmd === "rg" && args.some((a) => a === "--pre" || a.startsWith("--pre="))) return "rg --pre runs a program";
  if (cmd === "date" && args.some((a) => a === "-s" || a.startsWith("--set"))) return "date --set changes the clock";
  if (cmd === "file" && args.includes("-C")) return "file -C writes a file";
  return null;
}

function checkSegment(words: string[]): string | null {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  const [cmd, ...args] = words.slice(i);
  if (!cmd) return null;
  const name = cmd.split("/").pop()!;
  if (["eval", "xargs", "sudo", "exec", "source", ".", "env", "nohup", "command", "builtin", "time", "timeout", "watch"].includes(name)) return `\`${name}\` runs other commands`;
  if (name === "git") return checkGit(args);
  if (name === "gh") return checkGh(args);
  if (PLAIN.has(name)) return checkPlain(name, args);
  return `\`${name}\` is not on the read-only list`;
}

/** Whether a shell command only reads. Rejected commands come with a reason the agent can act on. */
export function readOnlyCommand(command: string): ReadOnlyResult {
  const tokens = tokenize(command);
  if (typeof tokens === "string") return { ok: false, reason: `${tokens} is not allowed` };
  const segments: string[][] = [[]];
  for (const t of tokens) {
    if ("redirect" in t) {
      if (t.redirect.startsWith("<<")) return { ok: false, reason: "heredocs are not allowed" };
      if (t.redirect.startsWith("<") && !t.redirect.startsWith("<>") && !t.redirect.startsWith("<&")) continue;
      if (!SAFE_REDIRECT.test(t.redirect)) return { ok: false, reason: "output redirection (>, >>) writes files" };
    } else if ("op" in t) segments.push([]);
    else if (t.word === "{" || t.word === "}") return { ok: false, reason: "a command group is not allowed" };
    else segments[segments.length - 1].push(t.word);
  }
  for (const words of segments) {
    const reason = checkSegment(words);
    if (reason) return { ok: false, reason };
  }
  return { ok: true };
}
