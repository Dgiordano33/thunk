import assert from "node:assert/strict";
import test from "node:test";
import { NoNativeDialog, pickFolder, revealInFileManager } from "./native.ts";

/** A fake runner: answers per executable, records calls, and throws ENOENT for unknown ones. */
function host(answers) {
  const calls = [];
  const exec = async (file, args, env) => {
    calls.push({ file, args, env });
    if (!(file in answers)) throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
    return { stdout: "", stderr: "", code: 0, ...answers[file] };
  };
  return { exec, calls };
}

test("macOS picker returns the chosen folder and null when cancelled", async () => {
  assert.equal(await pickFolder({ defaultPath: "/tmp" }, "darwin", host({ osascript: { stdout: "/Users/me/code/\n" } }).exec), "/Users/me/code");
  assert.equal(await pickFolder({}, "darwin", host({ osascript: { code: 1, stderr: "User canceled. (-128)" } }).exec), null);
});

test("Windows picker passes prompt and start folder through the environment", async () => {
  const { exec, calls } = host({ "powershell.exe": { stdout: "C:\\code\\thunk\r\n" } });
  assert.equal(await pickFolder({ prompt: "Pick'; rm -rf /", defaultPath: "C:\\code" }, "win32", exec), "C:\\code\\thunk");
  assert.equal(calls[0].env.THUNK_PICK_PROMPT, "Pick'; rm -rf /");
  assert.ok(!calls[0].args.join(" ").includes("rm -rf"));
  assert.equal(await pickFolder({}, "win32", host({ "powershell.exe": { stdout: "" } }).exec), null);
});

test("Linux picker tries zenity, then kdialog, then gives up", async () => {
  assert.equal(await pickFolder({}, "linux", host({ zenity: { stdout: "/home/me/code\n" } }).exec), "/home/me/code");
  assert.equal(await pickFolder({}, "linux", host({ zenity: { code: 1 } }).exec), null);
  const kde = host({ kdialog: { stdout: "/home/me/src\n" } });
  assert.equal(await pickFolder({}, "linux", kde.exec), "/home/me/src");
  assert.deepEqual(kde.calls.map((c) => c.file), ["zenity", "kdialog"]);
  await assert.rejects(pickFolder({}, "linux", host({}).exec), NoNativeDialog);
});

test("reveal uses Finder, Explorer, or the freedesktop file manager", async () => {
  const mac = host({ open: {} });
  await revealInFileManager("/Users/me/code", "darwin", mac.exec);
  assert.deepEqual(mac.calls[0].args, ["-R", "/Users/me/code"]);
  const win = host({ "explorer.exe": { code: 1 } });
  await revealInFileManager("C:\\code", "win32", win.exec);
  assert.deepEqual(win.calls[0].args, ["/select,C:\\code"]);
  const dbus = host({ gdbus: {} });
  await revealInFileManager("/home/me/my code", "linux", dbus.exec);
  assert.ok(dbus.calls[0].args.includes("['file:///home/me/my%20code']"));
  const plain = host({ "xdg-open": {} });
  await revealInFileManager("/home/me", "linux", plain.exec);
  assert.deepEqual(plain.calls.map((c) => c.file), ["gdbus", "xdg-open"]);
  await assert.rejects(revealInFileManager("/home/me", "linux", host({}).exec), /xdg-open is missing/);
});
