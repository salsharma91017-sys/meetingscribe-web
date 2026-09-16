import { NextResponse } from "next/server";
import { computeSessionToken, getExpectedCredentials, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let payload: { username?: string; password?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const username = (payload.username ?? "").trim();
  const password = payload.password ?? "";
  const expected = getExpectedCredentials();

  if (username !== expected.username || password !== expected.password) {
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }

  const token = await computeSessionToken(expected.username, expected.password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
