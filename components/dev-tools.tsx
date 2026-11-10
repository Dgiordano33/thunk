"use client";

import dynamic from "next/dynamic";

// Keep the development dependency out of the production client graph.
export const DevTools = process.env.NODE_ENV === "development"
  ? dynamic(() => import("retune").then((mod) => mod.Retune), { ssr: false })
  : () => null;
