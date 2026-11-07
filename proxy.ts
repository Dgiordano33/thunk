import { NextResponse, type NextRequest } from "next/server";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopback(urlish: string) {
  try {
    return LOOPBACK.has(new URL(urlish).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The API can spawn agents with arbitrary cwd and permission modes, so only serve it locally.
 * The Host check blocks LAN access and DNS rebinding; the Origin check blocks cross-site requests.
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const origin = req.headers.get("origin");
  if (!isLoopback(`http://${host}`) || (origin && !isLoopback(origin))) {
    return NextResponse.json({ error: "Forbidden: local access only" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
