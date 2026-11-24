import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

/**
 * The host's own folder dialog and file manager, for a browser on the same machine (see proxy.ts:
 * the API is local-only unless remote access is configured, and the UI only offers these locally).
 */

type Run = (file: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string; code: number }>;

const run: Run = (file, args, env) => new Promise((resolve, reject) => {
  execFile(file, args, { env: env ?? process.env, timeout: 10 * 60_000, windowsHide: true }, (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") return reject(error);
    resolve({ stdout, stderr, code: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
  });
});

/** Thrown when this host has no folder dialog Thunk can open; the UI then browses in the page. */
export class NoNativeDialog extends Error {}

export function expandHome(input: string | undefined) {
  return path.resolve((input ?? "~").trim().replace(/^~(?=$|[\\/])/, os.homedir()));
}

const MAC_PICKER = [
  "on run argv",
  "activate",
  "try",
  "set loc to POSIX file (item 2 of argv) as alias",
  "on error",
  "set loc to path to home folder",
  "end try",
  "return POSIX path of (choose folder with prompt (item 1 of argv) default location loc)",
  "end run",
];

// Prompt and start folder arrive through the environment so nothing is spliced into the script.
const WINDOWS_PICKER = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description = $env:THUNK_PICK_PROMPT",
  "$d.SelectedPath = $env:THUNK_PICK_START",
  "$d.ShowNewFolderButton = $true",
  "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }",
  "if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
].join("; ");

/** Opens the native folder dialog. Resolves to the chosen absolute path, or null if cancelled. */
export async function pickFolder({ prompt = "Choose a folder", defaultPath }: { prompt?: string; defaultPath?: string }, platform = process.platform, exec: Run = run): Promise<string | null> {
  const start = expandHome(defaultPath);
  const trim = (p: string) => p.trim().replace(/[\\/]+$/, "") || (platform === "win32" ? p.trim() : "/");
  if (platform === "darwin") {
    const result = await exec("osascript", [...MAC_PICKER.flatMap((l) => ["-e", l]), prompt, start]);
    if (result.code === 0) return trim(result.stdout);
    // -128 is AppleScript's "User canceled".
    if (result.stderr.includes("-128")) return null;
    throw new Error(result.stderr.trim() || "The folder dialog failed");
  }
  if (platform === "win32") {
    const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", WINDOWS_PICKER], { ...process.env, THUNK_PICK_PROMPT: prompt, THUNK_PICK_START: start });
    if (result.code !== 0) throw new Error(result.stderr.trim() || "The folder dialog failed");
    return result.stdout.trim() ? trim(result.stdout) : null;
  }
  // Linux and other Unix desktops: GNOME's zenity, else KDE's kdialog. Exit code 1 means cancelled.
  const dialogs: [string, string[]][] = [
    ["zenity", ["--file-selection", "--directory", `--title=${prompt}`, `--filename=${start}${path.sep}`]],
    ["kdialog", ["--getexistingdirectory", start, "--title", prompt]],
  ];
  for (const [file, args] of dialogs) {
    let result;
    try { result = await exec(file, args); } catch { continue; }
    if (result.code === 0) return trim(result.stdout);
    if (result.code === 1) return null;
    throw new Error(result.stderr.trim() || "The folder dialog failed");
  }
  throw new NoNativeDialog("No folder dialog on this host. Install zenity or kdialog, or browse in the page.");
}

/** Shows `dir` in the host's file manager: Finder, Explorer, or the Linux desktop's file manager. */
export async function revealInFileManager(dir: string, platform = process.platform, exec: Run = run) {
  if (platform === "darwin") {
    const result = await exec("open", ["-R", dir]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not open Finder");
    return;
  }
  if (platform === "win32") {
    // Explorer exits 1 even when it opens; only a missing explorer.exe is a failure.
    await exec("explorer.exe", [`/select,${dir}`]);
    return;
  }
  // The freedesktop FileManager1 interface selects the item (Nautilus, Dolphin, Nemo, Thunar…);
  // without it, open the folder itself.
  try {
    const uri = new URL(`file://${dir.split("/").map(encodeURIComponent).join("/")}`).href;
    const result = await exec("gdbus", ["call", "--session", "--dest", "org.freedesktop.FileManager1", "--object-path", "/org/freedesktop/FileManager1",
      "--method", "org.freedesktop.FileManager1.ShowItems", `['${uri.replace(/'/g, "%27")}']`, ""]);
    if (result.code === 0) return;
  } catch { /* No gdbus; fall through. */ }
  try {
    const result = await exec("xdg-open", [dir]);
    if (result.code === 0) return;
    throw new Error(result.stderr.trim() || "Could not open the file manager");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("No file manager found on this host (xdg-open is missing)");
    throw error;
  }
}

