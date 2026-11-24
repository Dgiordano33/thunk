const { test } = require("node:test");
const assert = require("node:assert/strict");
const { gitVersion, gitHelp, linuxFamily } = require("./prerequisites.cjs");

test("reports the installed Git version, or null when git cannot run", async () => {
  assert.equal(await gitVersion({}, async () => ({ stdout: "git version 2.47.1\n" })), "2.47.1");
  assert.equal(await gitVersion({}, async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }), null);
});

test("recognizes Linux distribution families from os-release", () => {
  assert.equal(linuxFamily(() => 'ID=ubuntu\nID_LIKE=debian\n'), "debian");
  assert.equal(linuxFamily(() => 'ID="fedora"\n'), "fedora");
  assert.equal(linuxFamily(() => 'ID=manjaro\nID_LIKE=arch\n'), "arch");
  assert.equal(linuxFamily(() => 'ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n'), "suse");
  assert.equal(linuxFamily(() => 'ID=nixos\n'), undefined);
  assert.equal(linuxFamily(() => { throw new Error("no file"); }), undefined);
});

test("explains how to install Git on each platform", () => {
  assert.deepEqual(gitHelp("darwin").action.command, ["xcode-select", ["--install"]]);
  assert.match(gitHelp("win32").detail, /winget install --id Git\.Git/);
  assert.match(gitHelp("linux", "debian").detail, /sudo apt install git/);
  assert.match(gitHelp("linux", "fedora").detail, /sudo dnf install git/);
  assert.doesNotMatch(gitHelp("linux", null).detail, /sudo/);
});
