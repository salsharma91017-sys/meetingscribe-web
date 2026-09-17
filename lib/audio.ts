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
  /** How much audio each uploaded chunk covers. Vercel Functions have a hard
   *  4.5MB request body limit on every plan -- a request over that is rejected
   *  by the platform itself before the app's code even runs, which surfaces as a
   *  confusing non-JSON error. At AUDIO_BITS_PER_SECOND below, 3 minutes of audio
   *  is ~1.4MB, leaving a big safety margin even if a browser doesn't fully honor
   *  the bitrate hint. */
  static readonly SEGMENT_MS = 3 * 60 * 1000;

  /** Bitrate requested from MediaRecorder. Whisper transcribes speech reliably at
   *  well under typical "music quality" bitrates, so this trades inaudible fidelity
   *  loss for a much smaller upload (keeps segments safely under Vercel's 4.5MB
   *  request body limit -- see SEGMENT_MS above). Not all browsers honor this
   *  hint exactly, which is why SEGMENT_MS also leaves headroom. */
  static readonly AUDIO_BITS_PER_SECOND = 64_000;

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
    const options: MediaRecorderOptions = {
      audioBitsPerSecond: SegmentedRecorder.AUDIO_BITS_PER_SECOND,
    };
    if (this.mimeType) options.mimeType = this.mimeType;
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
        // Same bookkeeping pause()/stop() do: fold the time since this segment
        // started into segmentAccumulatedMs *before* stopping the recorder. Without
        // this, onstop sees segmentAccumulatedMs still at 0 (it's never touched during
        // plain continuous recording), so the segment gets its duration recorded as
        // 0 -- which drops the whole segment's audio (the `durationMs > 0` guard in
        // onstop below rejects it) and makes the visible elapsed-time counter jump
        // back down to ~0 right as the next segment starts.
        this.segmentAccumulatedMs += performance.now() - this.segmentStartedAt;
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
