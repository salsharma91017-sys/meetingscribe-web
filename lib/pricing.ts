import { RecordingCost } from "./types";

/**
 * AI usage pricing, in USD. These are list prices, so what's shown in the app is an
 * estimate -- your actual invoice is the source of truth. Prices change; the figures here
 * were checked against the providers' own pages on 2026-10-13:
 *
 *  - OpenAI whisper-1: $0.006 per minute of audio
 *    (https://developers.openai.com/api/docs/models/whisper-1). OpenAI doesn't say how partial
 *    minutes are rounded, so cost is simply duration x rate.
 *  - Claude Sonnet 5: $2 per million input tokens, $10 per million output tokens
 *    (https://platform.claude.com/docs/en/about-claude/pricing).
 *
 * To change a price without touching code, set WHISPER_USD_PER_MINUTE, or
 * CLAUDE_INPUT_USD_PER_MTOK and CLAUDE_OUTPUT_USD_PER_MTOK (both together), in the server's
 * environment variables.
 */
export const DEFAULT_TRANSCRIPTION_USD_PER_MINUTE = 0.006;

export interface ClaudePrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

// Matched exactly (optionally with a -YYYYMMDD date suffix), never by prefix: a prefix match
// would price "claude-sonnet-5-5" as if it were "claude-sonnet-5", which is a different model
// with its own price. A model that isn't listed gets no price (null) rather than a wrong one.
const CLAUDE_PRICES: { pattern: RegExp; price: ClaudePrice }[] = [
  { pattern: /^claude-sonnet-5(-\d{8})?$/, price: { inputUsdPerMTok: 2, outputUsdPerMTok: 10 } },
  { pattern: /^claude-sonnet-4-5(-\d{8})?$/, price: { inputUsdPerMTok: 3, outputUsdPerMTok: 15 } },
];

export function claudePriceFor(model: string, override?: ClaudePrice | null): ClaudePrice | null {
  if (override) return override;
  const hit = CLAUDE_PRICES.find((p) => p.pattern.test(model));
  return hit ? hit.price : null;
}

/** Cost of one Claude call, or null if the model's price isn't known. */
export function claudeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  override?: ClaudePrice | null
): number | null {
  const price = claudePriceFor(model, override);
  if (!price) return null;
  return (
    (inputTokens / 1_000_000) * price.inputUsdPerMTok +
    (outputTokens / 1_000_000) * price.outputUsdPerMTok
  );
}

export function transcriptionCostUsd(
  seconds: number,
  usdPerMinute: number = DEFAULT_TRANSCRIPTION_USD_PER_MINUTE
): number {
  return (Math.max(0, seconds) / 60) * usdPerMinute;
}

/** A positive number from an environment variable, or undefined if unset/invalid. */
export function positiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function emptyCost(): RecordingCost {
  return {
    transcriptionUsd: 0,
    transcriptionSeconds: 0,
    transcriptionRuns: 0,
    reportUsd: 0,
    reportInputTokens: 0,
    reportOutputTokens: 0,
    reportRuns: 0,
  };
}

/** Adds one billed transcription segment. `newRun` is true for the first segment of a pass,
 *  so a pass of several segments counts as one run. */
export function addTranscription(
  cost: RecordingCost,
  seconds: number,
  usd: number,
  newRun: boolean
): RecordingCost {
  return {
    ...cost,
    transcriptionUsd: cost.transcriptionUsd + usd,
    transcriptionSeconds: cost.transcriptionSeconds + seconds,
    transcriptionRuns: cost.transcriptionRuns + (newRun ? 1 : 0),
  };
}

/** Adds one generated report. `usd` is null when the model's price is unknown. */
export function addReport(
  cost: RecordingCost,
  inputTokens: number,
  outputTokens: number,
  usd: number | null
): RecordingCost {
  return {
    ...cost,
    reportUsd: cost.reportUsd + (usd ?? 0),
    reportInputTokens: cost.reportInputTokens + inputTokens,
    reportOutputTokens: cost.reportOutputTokens + outputTokens,
    reportRuns: cost.reportRuns + 1,
    reportPriceUnknown: cost.reportPriceUnknown || usd === null || undefined,
  };
}

export function totalCostUsd(cost: RecordingCost): number {
  return cost.transcriptionUsd + cost.reportUsd;
}
