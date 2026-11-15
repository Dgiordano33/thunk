import { cookies } from "next/headers";
import { LOOK_COOKIE, parseLook, type Look } from "./look";

/** The visitor's chosen look, from their cookie. */
export async function getLook(): Promise<Look> {
  return parseLook((await cookies()).get(LOOK_COOKIE)?.value);
}
