"use client";

import { useSyncExternalStore } from "react";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const noop = () => () => {};

/**
 * True when this browser runs on the same machine as the Thunk server, so host-side actions
 * (the macOS folder dialog, Reveal in Finder) show up in front of the user. False during SSR.
 */
export function useLocalClient() {
  return useSyncExternalStore(noop, () => LOOPBACK.has(window.location.hostname), () => false);
}
