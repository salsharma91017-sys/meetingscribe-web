import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Vercel's own default is 300s on every plan (Hobby included), so this just
// gives real headroom for a slow Claude response without costing anything.
export const maxDuration = 90;

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

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        // Some templates (e.g. the white-paper-style ones) ask for a genuinely long,
        // detailed document -- 4096 was tight enough to truncate those. claude-sonnet-5
        // supports up to 128K output tokens in a standard request with no special beta
        // header needed, so this has plenty of headroom without being excessive.
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: extractAnthropicError(bodyText) }, { status: response.status });
    }

    const json = JSON.parse(bodyText) as { content?: AnthropicContentBlock[] };
    const text = (json.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("")
      .trim();

    const { title, report } = parseReportResponse(text);

    return NextResponse.json({ report, title });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown report generation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
