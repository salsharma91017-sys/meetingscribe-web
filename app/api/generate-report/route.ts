import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT =
  "You are an expert note-taker who writes clear, accurate reports strictly from the " +
  "transcript you are given. You never invent names, numbers, dates, or commitments that " +
  "are not present in the transcript. Respond with the report only, in Markdown, and " +
  "nothing else.";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

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
        max_tokens: 4096,
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

    return NextResponse.json({ report: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown report generation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
