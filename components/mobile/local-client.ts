"use client";

import { useSyncExternalStore } from "react";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const noop = () => () => {};

/**
 * True when this browser runs on the same machine as the Thunk server, so host-side actions
 * (the native folder dialog, revealing a folder) show up in front of the user. False during SSR.
 */
export function useLocalClient() {
  return useSyncExternalStore(noop, () => LOOPBACK.has(window.location.hostname), () => false);
}

/** The host's file manager as the user knows it. Only meaningful for a local client, whose OS is the host's. */
export function fileManagerName() {
  if (typeof navigator === "undefined") return "Finder";
  const ua = navigator.userAgent;
  return /Windows/.test(ua) ? "Explorer" : /Mac OS X|Macintosh/.test(ua) ? "Finder" : "file manager";
}
