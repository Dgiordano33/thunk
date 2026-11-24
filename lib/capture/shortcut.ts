import { useSyncExternalStore } from "react";

// Capture shortcuts in Electron accelerator form ("CommandOrControl+Shift+K"), so one recorder and one
// label serve the in-app shortcut (matched in the browser) and the OS-wide desktop one (globalShortcut).

export const DEFAULT_APP_SHORTCUT = "CommandOrControl+Shift+K";
export const APP_SHORTCUT_KEY = "thunk.capture.shortcut";
/** Taken elsewhere in Thunk: Search and Settings. */
export const RESERVED = ["CommandOrControl+K", "CommandOrControl+,"];

const CODES: Record<string, string> = {
  Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Period: ".", Comma: ",", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`",
};

function keyOf(code: string) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  return CODES[code] ?? null;
}

const noop = () => () => {};
/** Whether this is a Mac, or null while server-rendering, so labels don't mismatch on hydration. */
export const useIsMac = () => useSyncExternalStore(noop, isMac, () => null);

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

type Keys = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** The accelerator a key press spells, or null for a lone modifier or a key without a name. */
export function fromEvent(e: Keys, mac = isMac()): string | null {
  const key = keyOf(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push("CommandOrControl");
  if (mac ? e.ctrlKey : e.metaKey) parts.push(mac ? "Control" : "Super");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** Why a recorded shortcut can't be used, or null when it can. */
export function problem(accel: string): string | null {
  const parts = accel.split("+");
  if (parts.length < 2 && !/^F\d{1,2}$/.test(accel)) return "Add a modifier, like ⌘, Ctrl or ⌥.";
  if (parts.length === 2 && parts[0] === "Shift") return "Shift alone would fire while typing. Add ⌘, Ctrl or ⌥.";
  if (RESERVED.includes(accel)) return "Thunk already uses that shortcut.";
  return null;
}

export function matches(e: Keys, accel: string) {
  return Boolean(accel) && fromEvent(e) === accel;
}

const MAC_SYMBOLS: Record<string, string> = { CommandOrControl: "⌘", Command: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧", Space: "Space", Up: "↑", Down: "↓", Left: "←", Right: "→", Enter: "↩" };

/** "⇧⌘K" on a Mac, "Ctrl+Shift+K" elsewhere. */
export function label(accel: string, mac = isMac()) {
  if (!accel) return "Off";
  const parts = accel.split("+");
  if (mac) {
    const order = ["Control", "Alt", "Shift", "CommandOrControl", "Command"];
    const mods = parts.slice(0, -1).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return [...mods, parts.at(-1)!].map((p) => MAC_SYMBOLS[p] ?? p).join(mods.length && parts.at(-1)!.length > 1 ? " " : "");
  }
  return parts.map((p) => (p === "CommandOrControl" || p === "Control" ? "Ctrl" : p === "Super" ? "Win" : p)).join("+");
}

export function readAppShortcut() {
  try {
    const saved = localStorage.getItem(APP_SHORTCUT_KEY);
    if (saved !== null) return saved;
  } catch { /* Storage is optional. */ }
  return DEFAULT_APP_SHORTCUT;
}
