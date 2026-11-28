"use client";
import { TriageForm } from "@/components/notes/triage-settings";
import { BackupSettings } from "@/components/settings/backups";
import { LimitsSettings } from "./limits";

export function AutomationSettings() {
  return (
    <div className="space-y-6">
      <div className="max-w-md rounded-lg border bg-background/60 p-4">
        <TriageForm />
      </div>
      <div className="max-w-md rounded-lg border bg-background/60 p-4">
        <BackupSettings />
      </div>
      <LimitsSettings />
    </div>
  );
}
