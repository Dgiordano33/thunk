/** The app's visual look, chosen in Settings: the solar-system map (default) or the strategy-game world. */
export type Look = "space" | "world";

export const LOOKS: { value: Look; label: string }[] = [
  { value: "space", label: "Solar system" },
  { value: "world", label: "Game world" },
];

/** A cookie, so the server knows which map to render and the first paint is already right. */
export const LOOK_COOKIE = "thunk.look";
export const DEFAULT_LOOK: Look = "space";

export const parseLook = (value: string | null | undefined): Look => (value === "world" ? "world" : "space");
export const lookClass = (look: Look) => `look-${look}`;

/** Browser only: remember the look for a year and switch the root class straight away. */
export function storeLook(look: Look) {
  document.cookie = `${LOOK_COOKIE}=${look}; path=/; max-age=31536000; samesite=lax`;
  const root = document.documentElement.classList;
  root.remove(lookClass("space"), lookClass("world"));
  root.add(lookClass(look));
}
