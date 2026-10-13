import { NextResponse } from "next/server";
import { positiveNumber, transcriptionCostUsd, DEFAULT_TRANSCRIPTION_USD_PER_MINUTE } from "@/lib/pricing";

// Node runtime (not edge): we need FormData/Buffer handling and a longer
// execution budget than the edge runtime typically allows.
export const runtime = "nodejs";
// Vercel's own default is 300s on every plan (Hobby included), so this just
// gives real headroom for a slow Whisper response without costing anything.
export const maxDuration = 120;

function extractOpenAiError(body: string): string {
  try {
    const json = JSON.parse(body);
    return json?.error?.message || body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Server is missing OPENAI_API_KEY. Set it in your Vercel project's Environment Variables (or .env.local for local dev) and redeploy.",
      },
      { status: 500 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with an audio file." }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No audio file provided." }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append("file", file, file.name || "segment.webm");
  outgoing.append("model", "whisper-1");
  // verbose_json (instead of plain text) also returns the audio duration, which is what
  // Whisper bills by -- used to show the cost of each scribe.
  outgoing.append("response_format", "verbose_json");

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outgoing,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: extractOpenAiError(bodyText) }, { status: response.status });
    }

    let text = "";
    let durationSeconds: number | null = null;
    try {
      const json = JSON.parse(bodyText) as { text?: string; duration?: number | string };
      text = (json.text ?? "").trim();
      const d = Number(json.duration);
      durationSeconds = Number.isFinite(d) && d > 0 ? d : null;
    } catch {
      // Unexpected non-JSON body: treat it as the transcript itself.
      text = bodyText.trim();
    }

    // The client falls back to its own measured segment length if the duration is missing.
    const rate = positiveNumber(process.env.WHISPER_USD_PER_MINUTE) ?? DEFAULT_TRANSCRIPTION_USD_PER_MINUTE;
    const costUsd = durationSeconds !== null ? transcriptionCostUsd(durationSeconds, rate) : null;

    return NextResponse.json({ text, durationSeconds, costUsd, usdPerMinute: rate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown transcription error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
