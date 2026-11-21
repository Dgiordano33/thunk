"use client";

import dynamic from "next/dynamic";

// Keep the development dependency out of the production client graph. Browser tests leave it out too:
// its overlay sits over the page and takes clicks.
const Retune: React.ComponentType<{ port: number }> = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_THUNK_E2E !== "1"
  ? dynamic(() => import("retune").then((mod) => mod.Retune), { ssr: false })
  : () => null;

export function DevTools() {
  return <Retune port={Number(process.env.NEXT_PUBLIC_RETUNE_PORT || 9223)} />;
}
