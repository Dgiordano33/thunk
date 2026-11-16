import { cookies } from "next/headers";
import { POSITIONS_COOKIE, decodePositions, type Offset } from "./positions";

/** The visitor's arranged planet positions, from their cookie, so the server renders the layout they left. */
export async function getPlanetPositions(): Promise<Record<string, Offset>> {
  return decodePositions((await cookies()).get(POSITIONS_COOKIE)?.value);
}
