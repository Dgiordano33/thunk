"use client";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/components/onboarding/provider";
import { Button } from "@/components/ui/button";
import { PROJECTS_PATH } from "@/lib/routes";
import { SettingGroup, SettingRow } from "./setting-row";

export function HelpSettings() {
  const router = useRouter();
  const onboarding = useOnboarding();
  const go = (action: () => void) => { action(); router.push(PROJECTS_PATH); };
  return (
    <SettingGroup>
      <SettingRow label="Intro" description="The short tour shown on first launch.">
        <Button size="sm" variant="outline" onClick={() => go(() => onboarding.replay("intro"))}>Show intro</Button>
      </SettingRow>
      <SettingRow label="Map legend" description="What the shapes and badges on the projects map mean.">
        <Button size="sm" variant="outline" onClick={() => go(() => onboarding.replay("map-legend"))}>Show legend</Button>
      </SettingRow>
      <SettingRow label="Hints" description="Bring back every hint and the getting-started checklist you dismissed.">
        <Button size="sm" variant="outline" onClick={() => go(() => onboarding.resetAll())}>Reset hints</Button>
      </SettingRow>
    </SettingGroup>
  );
}
