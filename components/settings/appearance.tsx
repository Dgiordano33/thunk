"use client";
import { useLook } from "@/components/look-context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LOOKS, type Look } from "@/lib/look";
import { useUi } from "@/lib/store/ui-store";
import type { Theme } from "@/lib/theme";
import { SettingGroup, SettingRow } from "./setting-row";

export function AppearanceSettings() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const { look, setLook } = useLook();
  return (
    <SettingGroup>
      <SettingRow label="Theme" description="Light, dark, or follow your system.">
        <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <SelectTrigger size="sm" className="w-32" aria-label="Theme"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label="Look" description={look === "world" ? "How the projects map is drawn. The game world is always dark." : "How the projects map is drawn."}>
        <Select value={look} onValueChange={(value) => setLook(value as Look)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Look"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LOOKS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </SettingRow>
    </SettingGroup>
  );
}
