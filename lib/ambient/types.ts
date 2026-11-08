import type { WorkspaceDelivery } from "../projects/delivery-types";
import type { SessionMeta } from "../agent/types";
import type { RoutineRunActivity } from "../routines/types";

export type ActivitySession = SessionMeta & {
  projectName: string;
  workspaceName: string;
  pending: number;
  notice: { seq: number; message: string } | null;
};
export type SearchResult = { id: string; label: string; detail: string; href: string; kind: string };
export type UsageEntry = { sessionId: string; seq: number; ts: number; costUsd: number };
export type UsageSummary = { total: number; days: { name: string; cost: number }[]; workspaces: { id: string; cost: number }[] };
export type ActivityResponse = { sessions: ActivitySession[]; runs: RoutineRunActivity[]; deliveries: WorkspaceDelivery[] };
