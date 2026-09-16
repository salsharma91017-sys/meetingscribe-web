// Lightweight shared-password auth. This is intentionally simple (no user accounts, no
// database) — the goal is to keep the deployed URL from being usable by strangers who
// don't know the password, not to protect sensitive data. Works in both the Edge runtime
// (middleware) and the Node runtime (API routes) because it only uses Web Crypto (`crypto.subtle`),
// which both provide.

const SALT = "korevia-meetingscribe-v1";

export const SESSION_COOKIE = "ms_session";

export function getExpectedCredentials(): { username: string; password: string } {
  return {
    username: process.env.AUTH_USERNAME || "korevia",
    password: process.env.AUTH_PASSWORD || "korevia",
  };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Derives the session token that a valid login sets as a cookie, without ever storing
 *  the plaintext password in the cookie itself. */
export async function computeSessionToken(username: string, password: string): Promise<string> {
  return sha256Hex(`${username}:${password}:${SALT}`);
}
