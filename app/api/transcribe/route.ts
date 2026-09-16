import { NextResponse } from "next/server";

// Node runtime (not edge): we need FormData/Buffer handling and a longer
// execution budget than the edge runtime typically allows.
export const runtime = "nodejs";
export const maxDuration = 60;

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
  outgoing.append("response_format", "text");

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

    return NextResponse.json({ text: bodyText.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown transcription error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
