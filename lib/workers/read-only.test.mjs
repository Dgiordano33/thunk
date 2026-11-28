import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("./read-only.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { readOnlyCommand } = await import(`data:text/javascript,${encodeURIComponent(js)}`);

const allowed = [
  "ls -la",
  "cat README.md",
  "git status",
  "git status --short",
  "git log --oneline -20",
  "git log --oneline main..HEAD",
  "git diff --stat origin/main...HEAD",
  "git diff HEAD~1 -- lib/workers/service.ts",
  "git show HEAD:package.json",
  "git -C ../other-repo log -5 --format='%h %s'",
  "git --no-pager log -3",
  "git branch",
  "git branch -a",
  "git branch --show-current",
  "git branch --list 'feature/*'",
  "git worktree list",
  "git remote -v",
  "git rev-parse --abbrev-ref HEAD",
  "git ls-files | wc -l",
  "git blame -L 10,20 lib/agent/options.ts",
  "gh pr view 42 --json title,state",
  "gh pr list --state open",
  "gh pr checks 12",
  "gh pr diff 12 | head -100",
  "gh issue list --limit 10",
  "gh run view 123 --log-failed",
  "gh repo view",
  "rg -n \"chiefWriteCommand\" lib",
  "grep -rn 'TODO' lib | head -20",
  "find . -name '*.test.cjs' -not -path './node_modules/*'",
  "cd lib && ls",
  "cat package.json | jq '.scripts'",
  "wc -l lib/workers/*.ts | sort -n | tail -5",
  "ls missing 2>/dev/null || echo none",
  "git log -1 2>&1",
  "grep -c '>' notes.md",
  "rg 'a|b' -g '*.ts'",
  "head -50 docs/server.md; tail -20 docs/server.md",
  "tree -L 2 lib",
  "diff a.txt b.txt",
  "GIT_PAGER=cat git log -2",
  "echo \"$HOME\"",
  "stat -f %m package.json",
  "sort < list.txt | uniq -c",
];

const refused = [
  ["echo hi > file.txt", /redirection/],
  ["cat a >> b", /redirection/],
  ["git log | tee out.txt", /tee/],
  ["rm -rf build", /rm/],
  ["git commit -m wip", /git commit/],
  ["git push origin HEAD", /git push/],
  ["git merge feature", /git merge/],
  ["git checkout -b x", /git checkout/],
  ["git reset --hard", /git reset/],
  ["git branch -D old", /git branch/],
  ["git branch new-branch", /git branch/],
  ["git worktree add ../x", /worktree/],
  ["git remote add up https://x", /remote/],
  ["git -c core.pager=sh log", /-c/],
  ["git diff --output=patch.diff", /output/],
  ["gh pr merge 12 --squash", /gh pr merge/],
  ["gh pr create --fill", /gh pr create/],
  ["gh api repos/x/y -X DELETE", /gh api/],
  ["sed -i 's/a/b/' file", /sed/],
  ["mv a b", /mv/],
  ["cp a b", /cp/],
  ["echo $(rm -rf /)", /substitution/],
  ["echo `touch x`", /substitution/],
  ["echo \"$(touch x)\"", /substitution/],
  ["diff <(ls a) <(ls b)", /process substitution/],
  ["(cd x && rm y)", /subshell/],
  ["{ rm x; }", /group|rm/],
  ["eval 'rm x'", /eval/],
  ["ls | xargs rm", /xargs/],
  ["sudo ls", /sudo/],
  ["find . -name '*.tmp' -delete", /find/],
  ["find . -exec rm {} \\;", /find/],
  ["sort -o out.txt in.txt", /sort/],
  ["touch file", /touch/],
  ["npm install", /npm/],
  ["node -e 'require(\"fs\").writeFileSync(\"x\",\"\")'", /node/],
  ["ls & rm x", /background/],
  ["cat <<EOF\nhi\nEOF", /heredoc/],
  ["ls\nrm x", /rm/],
  ["ls; mkdir x", /mkdir/],
  ["true && git stash", /git stash/],
  ["rg --pre ./script.sh x", /--pre/],
  ["echo 'unclosed", /quote/],
  ["bash -c 'ls'", /bash/],
  ["ls | sh", /sh/],
];

test("read commands chiefs and scouts use are allowed", () => {
  for (const command of allowed) assert.deepEqual(readOnlyCommand(command), { ok: true }, command);
});

test("writes, the old regex's gaps, and anything unparseable are refused with a reason", () => {
  for (const [command, reason] of refused) {
    const result = readOnlyCommand(command);
    assert.equal(result.ok, false, command);
    assert.match(result.reason, reason, `${command}: ${result.reason}`);
  }
});
