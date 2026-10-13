export type RecordingStatus =
  | "recorded"
  | "transcribing"
  | "writing_report"
  | "done"
  | "error";

/** What this recording has cost in AI usage so far, in USD. Cumulative: every transcription
 *  pass and every report (re)generation adds to it, since each one is billed separately.
 *  Estimated from list prices (see lib/pricing.ts), not read from an invoice. */
export interface RecordingCost {
  transcriptionUsd: number;
  /** Seconds of audio sent for transcription, summed over every pass. */
  transcriptionSeconds: number;
  /** How many times the audio was (at least partly) transcribed. */
  transcriptionRuns: number;
  reportUsd: number;
  reportInputTokens: number;
  reportOutputTokens: number;
  /** How many reports were generated. */
  reportRuns: number;
  /** True if some report run couldn't be priced (model missing from the price table), in which
   *  case the totals understate the real cost. */
  reportPriceUnknown?: boolean;
}

/** Metadata for one recording. The actual audio lives in the "segments" store. */
export interface RecordingMeta {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  status: RecordingStatus;
  transcript?: string;
  reportMarkdown?: string;
  templateIdUsed?: string;
  errorMessage?: string;
  segmentCount: number;
  cost?: RecordingCost;
  /** Optional description of what the meeting is about, used to decide what counts as
   *  off-topic when the report is written. Remembered so a regeneration reuses it. */
  meetingScope?: string;
  /** Whether off-topic conversation was filtered out of the last report. */
  filterOffTopic?: boolean;
  /** Short, content-free descriptions of what the last report left out as off-topic. */
  omittedItems?: string[];
}

/** One chunk of audio belonging to a recording, stored in chronological order. */
export interface RecordingSegment {
  id: string; // `${recordingId}::${index}`
  recordingId: string;
  index: number;
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export interface Template {
  id: string;
  name: string;
  instructions: string;
  isBuiltIn: boolean;
}
