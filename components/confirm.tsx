"use client";

import { useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * `await confirm({ ... })` asks in an alert dialog and resolves true when confirmed. It replaces `window.confirm`,
 * which blocks the page, can't be styled, and is suppressed in some embedded browsers. Needs <ConfirmHost/> mounted
 * once (Providers does).
 */
export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  /** The confirm button's text, like "Delete". */
  action?: string;
  /** Marks the action as destructive: red, and focus starts on Cancel. */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirm(options: ConfirmOptions): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...options, resolve };
    emit();
  });
}

function settle(ok: boolean) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(ok);
}

export function ConfirmHost() {
  const current = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => pending,
    () => null,
  );
  return (
    <AlertDialog open={!!current} onOpenChange={(open) => { if (!open) settle(false); }}>
      {current && (
        <AlertDialogContent onOpenAutoFocus={(e) => {
          // A destructive question starts on Cancel, so Enter doesn't do it by accident.
          if (!current.destructive) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-slot="alert-dialog-cancel"]')?.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{current.title}</AlertDialogTitle>
            {current.description && <AlertDialogDescription>{current.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={current.destructive ? "destructive" : "default"} onClick={() => settle(true)}>{current.action ?? "Continue"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
