import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Vercel's own default AND maximum on every plan (Hobby included) is already 300s, so
// using the full 300s here costs nothing extra. This was previously capped at 90s, which
// wasn't enough headroom for a single non-streaming Claude call producing a genuinely
// long, detailed report (like the white-paper template) at max_tokens: 16000 -- that
// combination could take longer than 90s to finish, which Vercel then reports as a 504
// FUNCTION_INVOCATION_TIMEOUT (surfaced in the app as "The request took too long and
// timed out.").
export const maxDuration = 300;

const SYSTEM_PROMPT =
  "You are an expert note-taker who writes clear, accurate reports strictly from the " +
  "transcript you are given. You never invent names, numbers, dates, or commitments that " +
  "are not present in the transcript. " +
  "Respond in exactly this format and nothing else: first a single line starting with " +
  "'TITLE: ' followed by a short, specific meeting title (5-8 words, no quotes, based on " +
  "what was actually discussed — e.g. 'TITLE: Q3 Budget Review With Finance Team'), then a " +
  "line containing only '---', then the full report in Markdown.";

// claude-sonnet-4-5-20250929 (the previous default here) is on Anthropic's deprecation
// path with a tentative API retirement no sooner than 2026-09-29 -- claude-sonnet-5 is
// the current flagship Sonnet model and a stable (non-dated) alias, so it's used as the
// default instead. Override with CLAUDE_MODEL if you want to pin a specific model.
const DEFAULT_MODEL = "claude-sonnet-5";

function extractAnthropicError(body: string): string {
  try {
    const json = JSON.parse(body);
    return json?.error?.message || body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicCallResult {
  text: string;
  stopReason: string | null;
}

/** One non-streaming call to the Messages API. Throws (with a short, user-facing message)
 *  on a non-2xx response, matching the error shape the rest of this route already expects. */
async function callClaude(
  apiKey: string,
  model: string,
  messages: AnthropicMessage[],
  maxTokens: number
): Promise<AnthropicCallResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(extractAnthropicError(bodyText));
  }

  const json = JSON.parse(bodyText) as {
    content?: AnthropicContentBlock[];
    stop_reason?: string | null;
  };
  const text = (json.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");

  return { text, stopReason: json.stop_reason ?? null };
}

/** Splits the model's "TITLE: ...\n---\n<report>" response into its parts. Falls back to
 *  treating the whole response as the report if the model didn't follow the format. */
function parseReportResponse(raw: string): { title: string | null; report: string } {
  const match = raw.match(/^\s*TITLE:\s*(.+?)\s*\r?\n-{3,}\s*\r?\n([\s\S]*)$/);
  if (match) {
    const title = match[1].trim().replace(/^["']|["']$/g, "");
    const report = match[2].trim();
    if (title && report) return { title, report };
  }
  return { title: null, report: raw.trim() };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Server is missing ANTHROPIC_API_KEY. Set it in your Vercel project's Environment Variables (or .env.local for local dev) and redeploy.",
      },
      { status: 500 }
    );
  }

  let payload: { transcript?: string; templateInstructions?: string; model?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { transcript, templateInstructions } = payload;
  if (!transcript || !templateInstructions) {
    return NextResponse.json({ error: "Missing transcript or template instructions." }, { status: 400 });
  }

  const model = payload.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const userContent =
    `${templateInstructions.trim()}\n\n---TRANSCRIPT START---\n${transcript.trim()}\n---TRANSCRIPT END---`;

  // Some templates (e.g. the white-paper-style ones, or long/dense meetings like an
  // hours-long operations review) ask for a genuinely long, detailed document. A single
  // non-streaming call is capped at INITIAL_MAX_TOKENS output tokens -- if Claude hits that
  // cap mid-report (stop_reason: "max_tokens"), the response would previously just be cut
  // off mid-sentence with no error at all, which is confusing (it looks like the report
  // "finished" but is actually incomplete). Instead, when that happens, this makes up to
  // MAX_CONTINUATIONS follow-up calls asking Claude to continue from where it stopped.
  //
  // The natural way to do this is "assistant message prefill" (send the partial answer back
  // as the last message with role "assistant", so the API just continues that exact turn).
  // claude-sonnet-5 doesn't support that ("This model does not support assistant message
  // prefill. The conversation must end with a user message."), so instead the partial answer
  // is sent back as an assistant turn followed by an explicit user turn asking it to continue
  // from exactly that point with no repeated or re-summarized content -- slightly less
  // guaranteed seamless than true prefill, but works with any model.
  //
  // Token/time budget: this route is one blocking sequence of calls, so all of their
  // generation time counts against maxDuration (300s) above. At typical Sonnet throughput
  // (roughly 65 output tokens/sec), INITIAL_MAX_TOKENS (8000) + MAX_CONTINUATIONS *
  // CONTINUATION_MAX_TOKENS (1 * 6000) = 14000 tokens worst-case is ~215s of generation,
  // leaving headroom for input processing and network latency across the up-to-2 calls.
  // Going further (e.g. a 2nd continuation) would push the worst case close to or past the
  // 300s ceiling and risk trading this truncation problem for the earlier 504 timeout
  // problem, so it's intentionally limited to one continuation round.
  const INITIAL_MAX_TOKENS = 8000;
  const CONTINUATION_MAX_TOKENS = 6000;
  const MAX_CONTINUATIONS = 1;
  const CONTINUE_INSTRUCTION =
    "Your previous response was cut off before it was finished. Continue writing from " +
    "exactly where you left off. Do not repeat anything you already wrote, do not " +
    "re-summarize, do not restate the TITLE line or the '---' separator, and do not add any " +
    "preamble like 'Continuing...' -- just resume the Markdown report text, starting with " +
    "whatever character would naturally come next.";

  try {
    let full = "";
    let stopReason: string | null = null;
    let continuations = 0;

    while (true) {
      const messages: AnthropicMessage[] =
        continuations === 0
          ? [{ role: "user", content: userContent }]
          : [
              { role: "user", content: userContent },
              { role: "assistant", content: full },
              { role: "user", content: CONTINUE_INSTRUCTION },
            ];
      const maxTokens = continuations === 0 ? INITIAL_MAX_TOKENS : CONTINUATION_MAX_TOKENS;

      const result = await callClaude(apiKey, model, messages, maxTokens);
      full += result.text;
      stopReason = result.stopReason;

      if (stopReason !== "max_tokens" || continuations >= MAX_CONTINUATIONS) break;
      continuations += 1;
    }

    let { title, report } = parseReportResponse(full.trim());

    if (stopReason === "max_tokens") {
      report +=
        "\n\n---\n\n*Note: this report was cut off because it hit the model's maximum " +
        "output length, even after an automatic continuation. Try regenerating, splitting " +
        "the meeting into shorter recordings, or using a shorter/less detailed template.*";
    }

    return NextResponse.json({ report, title, truncated: stopReason === "max_tokens" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown report generation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
