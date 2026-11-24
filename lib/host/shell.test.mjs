import assert from "node:assert/strict";
import test from "node:test";
import { commandShell, defaultShell, interactiveShell } from "./shell.ts";

test("macOS and Linux run commands through the login shell", () => {
  assert.deepEqual(commandShell("npm run dev", { platform: "darwin", env: { SHELL: "/bin/zsh" } }), { file: "/bin/zsh", args: ["-lc", "npm run dev"] });
  assert.deepEqual(commandShell("npm test", { platform: "linux", env: {} }), { file: "/bin/bash", args: ["-lc", "npm test"] });
  assert.equal(defaultShell({ platform: "darwin", env: {} }), "/bin/zsh");
  assert.deepEqual(interactiveShell({ platform: "linux", env: { SHELL: "/usr/bin/fish" } }), { file: "/usr/bin/fish", args: ["-l"] });
});

test("Windows uses cmd.exe for commands and PowerShell for terminals", () => {
  const env = { ComSpec: "C:\\Windows\\system32\\cmd.exe" };
  assert.deepEqual(commandShell('echo "hi" && npm run dev', { platform: "win32", env }),
    { file: env.ComSpec, args: ["/d", "/s", "/c", '"echo "hi" && npm run dev"'], verbatim: true });
  assert.deepEqual(interactiveShell({ platform: "win32", env }), { file: "powershell.exe", args: ["-NoLogo"] });
  assert.equal(defaultShell({ platform: "win32", env: {} }), "cmd.exe");
});

test("Windows honours a POSIX SHELL such as Git Bash", () => {
  const env = { SHELL: "C:\\Program Files\\Git\\bin\\bash.exe" };
  assert.deepEqual(commandShell("make", { platform: "win32", env }), { file: env.SHELL, args: ["-lc", "make"] });
  assert.deepEqual(interactiveShell({ platform: "win32", env }), { file: env.SHELL, args: ["-l"] });
});
