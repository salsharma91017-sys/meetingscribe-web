"use client";

/**
 * Records audio in small, upload-friendly chunks instead of one giant file.
 *
 * Why: a long meeting recorded as a single file can get large, and serverless
 * functions (Vercel included) cap request body size and execution time. So
 * instead of recording one file and slicing it up afterwards (hard to do
 * losslessly with compressed containers like webm in the browser), this
 * rotates to a brand new MediaRecorder every few minutes, handing back a
 * sequence of small, independently-decodable audio blobs as it goes. Pause
 * and resume use MediaRecorder's native pause()/resume() and don't trigger a
 * rotation.
 */
export type RecorderState = "idle" | "recording" | "paused";

export type SegmentReadyHandler = (blob: Blob, durationMs: number, index: number) => void;

export class SegmentedRecorder {
  /** How much audio each uploaded chunk covers. Kept short to stay well under
   *  typical serverless request-body limits regardless of exact bitrate. */
  static readonly SEGMENT_MS = 4 * 60 * 1000;

  private stream: MediaStream | null = null;
  private mimeType = "";
  private currentRecorder: MediaRecorder | null = null;
  private state: RecorderState = "idle";
  private segmentIndex = 0;
  private onSegmentReady: SegmentReadyHandler | null = null;

  private segmentStartedAt = 0;
  private segmentAccumulatedMs = 0;
  private overallSegmentStartAccum = 0;
  private rotationTimeout: ReturnType<typeof setTimeout> | null = null;

  static pickMimeType(): string {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return "";
  }

  getState(): RecorderState {
    return this.state;
  }

  getMimeType(): string {
    return this.mimeType || "audio/webm";
  }

  async start(onSegmentReady: SegmentReadyHandler): Promise<void> {
    this.onSegmentReady = onSegmentReady;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType = SegmentedRecorder.pickMimeType();
    this.segmentIndex = 0;
    this.segmentAccumulatedMs = 0;
    this.overallSegmentStartAccum = 0;
    this.beginSegment();
  }

  pause(): void {
    if (this.state !== "recording" || !this.currentRecorder) return;
    this.segmentAccumulatedMs += performance.now() - this.segmentStartedAt;
    this.clearRotationTimer();
    try {
      this.currentRecorder.pause();
    } catch {
      // Some browsers may not support pause(); the recording just keeps going.
    }
    this.state = "paused";
  }

  resume(): void {
    if (this.state !== "paused" || !this.currentRecorder) return;
    try {
      this.currentRecorder.resume();
    } catch {
      // ignore
    }
    this.segmentStartedAt = performance.now();
    this.state = "recording";
    const remaining = Math.max(1000, SegmentedRecorder.SEGMENT_MS - this.segmentAccumulatedMs);
    this.scheduleRotation(remaining);
  }

  async stop(): Promise<void> {
    if (this.state === "idle") return;
    this.clearRotationTimer();
    if (this.state === "recording") {
      this.segmentAccumulatedMs += performance.now() - this.segmentStartedAt;
    }
    // Setting state to idle first means the pending onstop handler (below)
    // will finalize this segment but won't rotate into a new one.
    this.state = "idle";

    const recorder = this.currentRecorder;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.currentRecorder = null;
  }

  getElapsedMs(): number {
    if (this.state === "recording") {
      return (
        this.overallSegmentStartAccum +
        this.segmentAccumulatedMs +
        (performance.now() - this.segmentStartedAt)
      );
    }
    return this.overallSegmentStartAccum + this.segmentAccumulatedMs;
  }

  private beginSegment(): void {
    if (!this.stream) return;
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
    const recorder = new MediaRecorder(this.stream, options);
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: this.mimeType || "audio/webm" });
      const durationMs = this.segmentAccumulatedMs;
      const index = this.segmentIndex;

      if (durationMs > 0 && blob.size > 0) {
        this.onSegmentReady?.(blob, durationMs, index);
      }

      this.segmentIndex += 1;
      this.overallSegmentStartAccum += durationMs;
      this.segmentAccumulatedMs = 0;

      if (this.state === "recording") {
        this.beginSegment();
      }
    };

    this.currentRecorder = recorder;
    recorder.start();
    this.segmentStartedAt = performance.now();
    this.state = "recording";
    this.scheduleRotation(SegmentedRecorder.SEGMENT_MS);
  }

  private scheduleRotation(delayMs: number): void {
    this.clearRotationTimer();
    this.rotationTimeout = setTimeout(() => {
      if (
        this.state === "recording" &&
        this.currentRecorder &&
        this.currentRecorder.state === "recording"
      ) {
        this.currentRecorder.stop();
      }
    }, delayMs);
  }

  private clearRotationTimer(): void {
    if (this.rotationTimeout) {
      clearTimeout(this.rotationTimeout);
      this.rotationTimeout = null;
    }
  }
}
