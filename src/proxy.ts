import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: redirects visitors without a session cookie away from
// the staff app. Real authentication and authorization happen on the server
// for every request (src/server/auth/context.ts) and in PostgreSQL RLS.
const PUBLIC_PREFIXES = ["/login", "/register", "/manifest.webmanifest", "/icon.svg"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!request.cookies.has("cdp_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
