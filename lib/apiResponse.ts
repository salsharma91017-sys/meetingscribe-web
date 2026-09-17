/**
 * Reads a fetch Response that is expected to be JSON, but tolerates it not being --
 * which happens when a hosting platform's own error page (not this app's code)
 * answers the request instead. Every API route in this app always returns valid
 * JSON itself, even on error, so a non-JSON body here means the request never
 * reached that route code at all (e.g. Vercel's 4.5MB request body limit rejecting
 * an oversized upload before the function ever runs, or a gateway timeout).
 */
export async function readJsonResponse(res: Response): Promise<any> {
  const bodyText = await res.text();

  let data: unknown = null;
  let parseFailed = false;
  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parseFailed = true;
  }

  if (parseFailed) {
    const hint =
      res.status === 413
        ? "The upload was too large for the server to accept."
        : res.status === 504
        ? "The request took too long and timed out."
        : `The server returned an unexpected response (HTTP ${res.status}).`;
    throw new Error(hint);
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (HTTP ${res.status}).`;
    throw new Error(message);
  }

  return data;
}
