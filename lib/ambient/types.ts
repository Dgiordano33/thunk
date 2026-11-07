import type { SessionMeta } from "../agent/types";

export type ActivitySession = SessionMeta & {
  projectName: string;
  workspaceName: string;
  pending: number;
  notice: { seq: number; message: string } | null;
};
export type SearchResult = { id: string; label: string; detail: string; href: string; kind: string };
export type UsageEntry = { sessionId: string; seq: number; ts: number; costUsd: number };
export type UsageSummary = { total: number; days: { name: string; cost: number }[]; workspaces: { id: string; cost: number }[] };
