// Settings sections, in rail order. Shared between server and client: keep free of server-only imports.

export const SETTINGS_PATH = "/settings";

export type SettingsScope = "browser" | "server";

export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance", blurb: "Theme and map look", scope: "browser" },
  { id: "capture", label: "Relay", blurb: "Shortcuts that open Relay", scope: "browser" },
  { id: "notifications", label: "Notifications", blurb: "What reaches you on the desktop and in Slack", scope: "server" },
  { id: "agents", label: "Agents", blurb: "Claude and Codex, and the setup sessions load", scope: "server" },
  { id: "integrations", label: "Integrations", blurb: "Slack and Linear", scope: "server" },
  { id: "automation", label: "Automation", blurb: "Daily notes triage and server limits", scope: "server" },
  { id: "usage", label: "Usage", blurb: "What agents report they cost", scope: "server" },
  { id: "help", label: "Help", blurb: "Intro, legend and hints", scope: "browser" },
] as const satisfies readonly { id: string; label: string; blurb: string; scope: SettingsScope }[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export function settingsSection(id: string) {
  return SETTINGS_SECTIONS.find((s) => s.id === id);
}

export function settingsPath(id: SettingsSectionId) {
  return `${SETTINGS_PATH}/${id}`;
}
