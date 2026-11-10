"use client";
import { Loader2Icon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { SessionMeta } from "@/lib/agent/types";

export function SendMenu({
  sessions,
  onPick,
  label,
  compact,
  disabled,
}: {
  sessions: SessionMeta[];
  onPick: (sessionId: string | null) => void;
  label: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button size="icon-xs" variant="ghost" disabled={disabled} aria-label="Send to session" className="sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100">
            <SendIcon />
          </Button>
        ) : (
          <Button size="xs" variant="outline" disabled={disabled}>
            {disabled ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {label}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs">Send to session</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onPick(null)}>New chat</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("worker")}>New worktree</DropdownMenuItem>
        {sessions.length > 0 && <DropdownMenuSeparator />}
        {sessions.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => onPick(s.id)}>
            <span className="truncate">{s.title || "Untitled session"}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
