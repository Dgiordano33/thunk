import { redirect } from "next/navigation";
import { isMobileRequest } from "@/components/mobile/viewport.server";
import { SettingsIndex } from "@/components/settings/settings-shell";
import { SETTINGS_SECTIONS, settingsPath } from "@/components/settings/sections";

export const dynamic = "force-dynamic";

// Desktop opens the first section beside the rail; phones get the section list.
export default async function SettingsPage() {
  if (!(await isMobileRequest())) redirect(settingsPath(SETTINGS_SECTIONS[0].id));
  return <SettingsIndex />;
}
