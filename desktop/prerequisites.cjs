const { execFile } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { promisify } = require("node:util");
const exec = promisify(execFile);

/**
 * Git is the one tool Thunk needs that the app does not bundle on macOS or Linux (Windows builds can
 * bundle MinGit). Check for it with the same PATH the server gets, and say how to install it here.
 */
async function gitVersion(env, run = exec) {
  try {
    const { stdout } = await run("git", ["--version"], { env, timeout: 10000, windowsHide: true });
    return stdout.trim().replace(/^git version\s*/, "") || "installed";
  } catch {
    // On macOS, /usr/bin/git is a stub that fails until the Command Line Tools are installed.
    return null;
  }
}

/** The Linux distribution family from /etc/os-release: "debian", "fedora", "arch", "suse", or undefined. */
function linuxFamily(read = () => readFileSync("/etc/os-release", "utf8")) {
  let text;
  try { text = read(); } catch { return undefined; }
  const field = (name) => (text.match(new RegExp(`^${name}=["']?([^"'\\n]*)`, "m"))?.[1] ?? "").toLowerCase();
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((id) => ["debian", "ubuntu"].includes(id))) return "debian";
  if (ids.some((id) => ["fedora", "rhel", "centos"].includes(id))) return "fedora";
  if (ids.includes("arch")) return "arch";
  if (ids.some((id) => id.startsWith("opensuse") || id === "suse")) return "suse";
  return undefined;
}

const LINUX_COMMANDS = {
  debian: "sudo apt install git",
  fedora: "sudo dnf install git",
  arch: "sudo pacman -S git",
  suse: "sudo zypper install git",
};

/** How to install Git on this platform: the dialog text and, where there is one, an action. */
function gitHelp(platform = process.platform, family = platform === "linux" ? linuxFamily() : undefined) {
  if (platform === "darwin") {
    return {
      detail: "Thunk uses Git for projects, workspaces and pull requests. On a Mac it comes with Apple's Command Line Tools, a free download from Apple.",
      action: { label: "Install Command Line Tools", command: ["xcode-select", ["--install"]] },
    };
  }
  if (platform === "win32") {
    return {
      detail: "Thunk uses Git for projects, workspaces and pull requests. Install Git for Windows, then reopen Thunk. With winget: winget install --id Git.Git -e",
      action: { label: "Open Git Download Page", url: "https://git-scm.com/downloads/win" },
    };
  }
  const command = LINUX_COMMANDS[family];
  return {
    detail: `Thunk uses Git for projects, workspaces and pull requests. Install it with your package manager${command ? `:\n\n${command}` : ""}, then reopen Thunk.`,
    action: { label: "Open Git Download Page", url: "https://git-scm.com/downloads/linux" },
  };
}

module.exports = { gitVersion, gitHelp, linuxFamily };
