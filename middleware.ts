import { NextRequest, NextResponse } from "next/server";
import { computeSessionToken, getExpectedCredentials, SESSION_COOKIE } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;

  if (cookie) {
    const { username, password } = getExpectedCredentials();
    const expected = await computeSessionToken(username, password);
    if (cookie === expected) {
      return NextResponse.next();
    }
  }

  const loginUrl = new URL("/login", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next && next !== "/") loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}

// Everything requires a session except the login page/API and static assets.
export const config = {
  matcher: [
    "/((?!login|api/login|_next/static|_next/image|favicon.ico|icon.svg|korevia-logo.png).*)",
  ],
};
