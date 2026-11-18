import "server-only";
import { headers } from "next/headers";

/** Best guess from the user agent, used for the first render before the client can measure the viewport. */
export async function isMobileRequest() {
  return /Mobile|iPhone|Android.*Mobile/i.test((await headers()).get("user-agent") ?? "");
}
