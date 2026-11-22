import { notFound } from "next/navigation";
import { loadSidebarProjects } from "@/components/layout/sidebar-tree";
import { AgentSettings } from "@/components/settings/agents";
import { AppearanceSettings } from "@/components/settings/appearance";
import { AutomationSettings } from "@/components/settings/automation";
import { HelpSettings } from "@/components/settings/help";
import { IntegrationSettings } from "@/components/settings/integrations";
import { NotificationSettings } from "@/components/settings/notifications";
import { settingsSection } from "@/components/settings/sections";
import { UsageSettings } from "@/components/settings/usage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/settings/[section]">) {
  const section = settingsSection((await params).section);
  return { title: section ? `${section.label} · Settings · Thunk` : "Settings · Thunk" };
}

export default async function SettingsSectionPage({ params }: PageProps<"/settings/[section]">) {
  const section = settingsSection((await params).section);
  if (!section) notFound();
  switch (section.id) {
    case "appearance": return <AppearanceSettings />;
    case "notifications": return <NotificationSettings />;
    case "agents": return <AgentSettings />;
    case "integrations": return <IntegrationSettings />;
    case "automation": return <AutomationSettings />;
    case "help": return <HelpSettings />;
    case "usage": {
      const projects = await loadSidebarProjects().catch(() => []);
      return <UsageSettings projects={projects.map((p) => ({ id: p.id, name: p.name, workspaces: p.workspaces.map((w) => ({ id: w.id, name: w.name })) }))} />;
    }
  }
}
