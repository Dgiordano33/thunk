export const ONBOARDING_COOKIE = "thunk.onboarding";
export const HINT_KEYS = ["intro", "map-legend", "workspace-repos", "first-document", "harvest", "relay", "relay-note", "checklist-dismissed"] as const;
export type HintKey = typeof HINT_KEYS[number];
export function parseOnboarding(value?: string | null): HintKey[] {
  return [...new Set((value ?? "").split(",").filter((key): key is HintKey => HINT_KEYS.includes(key as HintKey)))];
}
export function initialOnboarding(value: string | undefined, hasProjects: boolean): HintKey[] {
  return value === undefined && hasProjects ? ["intro"] : parseOnboarding(value);
}
export function storeOnboarding(keys: HintKey[]) {
  // Keep an empty cookie on reset so existing-install detection doesn't suppress the replay.
  document.cookie = `${ONBOARDING_COOKIE}=${keys.join(",")}; path=/; max-age=31536000; samesite=lax`;
}
