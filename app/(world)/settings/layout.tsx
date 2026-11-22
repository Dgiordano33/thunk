import { SettingsShell } from "@/components/settings/settings-shell";

export const metadata = { title: "Settings · Thunk" };

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return <SettingsShell>{children}</SettingsShell>;
}
