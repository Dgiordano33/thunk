import "server-only";
import * as repo from "@/lib/supabase/repo/notifications";
import { emitNotification } from "./events";
import type { NewNotification, Notification } from "./types";

export async function notify(input: NewNotification) {
  const result = await repo.openNotification(input);
  emitNotification({ kind: result.created ? "opened" : "updated", notification: result.row });
  return result.row;
}
async function updated(rows: Promise<Notification[]>) {
  const result = await rows;
  for (const notification of result) emitNotification({ kind: "updated", notification });
  return result;
}
export const resolveBySubject = (subject: string) => updated(repo.resolveBySubject(subject));
export const resolveWhere = (match: Parameters<typeof repo.resolveWhere>[0]) => updated(repo.resolveWhere(match));
export const markRead = (ids: string[]) => updated(repo.markRead(ids));
export const dismiss = (id: string) => updated(repo.dismiss(id));
export const dismissAll = (projectId?: string) => updated(repo.dismissAll(projectId));
