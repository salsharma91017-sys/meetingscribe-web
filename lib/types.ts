export type RecordingStatus =
  | "recorded"
  | "transcribing"
  | "writing_report"
  | "done"
  | "error";

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
