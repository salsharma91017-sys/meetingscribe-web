import { NextResponse } from "next/server";
import { buildSystemPrompt, buildUserContent } from "@/lib/reportFormat";
import { claudeCostUsd, positiveNumber, ClaudePrice } from "@/lib/pricing";

export const runtime = "nodejs";
// Vercel's own default AND maximum on every plan (Hobby included) is already 300s, so
// using the full 300s here costs nothing extra. This was previously capped at 90s, which
// wasn't enough headroom for a single non-streaming Claude call producing a genuinely
// long, detailed report (like the white-paper template) at max_tokens: 16000 -- that
// combination could take longer than 90s to finish, which Vercel then reports as a 504
// FUNCTION_INVOCATION_TIMEOUT (surfaced in the app as "The request took too long and
// timed out.").
export const maxDuration = 300;

// The system prompt (including the off-topic guard rails) is built per request by
// buildSystemPrompt() in lib/reportFormat.ts.

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
  inputTokens: number;
  outputTokens: number;
}

/** One non-streaming call to the Messages API. Throws (with a short, user-facing message)
 *  on a non-2xx response, matching the error shape the rest of this route already expects. */
async function callClaude(
  apiKey: string,
  model: string,
  system: string,
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
      system,
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
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (json.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");

  return {
    text,
    stopReason: json.stop_reason ?? null,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
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

  let payload: {
    transcript?: string;
    templateInstructions?: string;
    model?: string;
    meetingScope?: string;
    filterOffTopic?: boolean;
    /** Text already written by earlier calls; when present, this call continues it. */
    partial?: string;
  };
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
  // On unless the client explicitly turns it off.
  const filterOffTopic = payload.filterOffTopic !== false;
  const system = buildSystemPrompt(filterOffTopic);
  const userContent = buildUserContent(templateInstructions, transcript, filterOffTopic ? payload.meetingScope : undefined);

  // Optional price override (both values required), for models missing from lib/pricing.ts.
  const inOverride = positiveNumber(process.env.CLAUDE_INPUT_USD_PER_MTOK);
  const outOverride = positiveNumber(process.env.CLAUDE_OUTPUT_USD_PER_MTOK);
  const priceOverride: ClaudePrice | null =
    inOverride !== undefined && outOverride !== undefined
      ? { inputUsdPerMTok: inOverride, outputUsdPerMTok: outOverride }
      : null;

  // ONE Claude call per request. Long reports (a dense hours-long meeting with a detailed
  // template) can need more output than fits in one call, and chaining several calls inside a
  // single request is capped by the 300s function limit -- which is how reports used to get
  // "cut off ... even after an automatic continuation". So the continuation loop now lives in the
  // browser (components/RecordingDetail.tsx): it calls this route again with `partial` (the text
  // written so far) for as long as Claude says it hit its output limit, so each request is
  // short (8000 tokens is roughly two minutes) and a report can run to many parts.
  //
  // Continuing uses an assistant turn followed by an explicit user turn, not assistant "prefill",
  // because claude-sonnet-5 rejects prefill ("This model does not support assistant message
  // prefill. The conversation must end with a user message.").
  const MAX_TOKENS_PER_CALL = 8000;
  const CONTINUE_INSTRUCTION =
    "Your previous response was cut off before it was finished. Continue writing from " +
    "exactly where you left off. Do not repeat anything you already wrote, do not " +
    "re-summarize, do not restate the TITLE line or the '---' separator, and do not add any " +
    "preamble like 'Continuing...' -- just resume the Markdown report text, starting with " +
    "whatever character would naturally come next.";

  const partial = typeof payload.partial === "string" ? payload.partial : "";
  const messages: AnthropicMessage[] = partial
    ? [
        { role: "user", content: userContent },
        { role: "assistant", content: partial },
        { role: "user", content: CONTINUE_INSTRUCTION },
      ]
    : [{ role: "user", content: userContent }];

  try {
    const result = await callClaude(apiKey, model, system, messages, MAX_TOKENS_PER_CALL);
    const costUsd = claudeCostUsd(model, result.inputTokens, result.outputTokens, priceOverride);

    return NextResponse.json({
      chunk: result.text,
      stopReason: result.stopReason,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      costUsd,
      model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown report generation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
