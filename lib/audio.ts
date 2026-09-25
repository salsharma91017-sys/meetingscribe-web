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

export interface StartOptions {
  /** When true, in addition to the microphone, also asks the browser to share a
   *  tab/window/screen's audio (getDisplayMedia) and mixes it in -- this is what
   *  makes it possible to record BOTH sides of an online meeting (Zoom/Meet/Teams)
   *  when you're on earphones, since the other participants' audio only goes to
   *  your ears otherwise and the microphone alone never picks it up. See the
   *  README's "Recording an online meeting" section for what's actually supported
   *  where (it varies a fair bit by browser/OS). */
  includeSystemAudio?: boolean;
  /** Fires if system audio was included but then stops mid-recording -- most often
   *  the user clicking Chrome's own "Stop sharing" bar. Recording is NOT stopped
   *  when this happens; it just continues on the microphone alone from that point,
   *  and this callback exists so the UI can tell the user that happened. */
  onSystemAudioEnded?: () => void;
}

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

  /** The stream actually fed to MediaRecorder -- either the raw mic stream, or (when
   *  includeSystemAudio was used) a mixed-down stream combining it with system/tab
   *  audio. Tearing this down alone in stop() is NOT enough in the mixed case (see
   *  micStream/displayStream/audioContext below). */
  private stream: MediaStream | null = null;
  /** The microphone stream on its own -- kept separately from `stream` so stop() can
   *  release the actual hardware track even when `stream` is a synthetic mixed one. */
  private micStream: MediaStream | null = null;
  /** The getDisplayMedia() stream (audio only by the time start() is done with it --
   *  its video track is stopped immediately, see start()), when includeSystemAudio
   *  was used. */
  private displayStream: MediaStream | null = null;
  /** The Web Audio graph used to mix micStream + displayStream into `stream`, when
   *  includeSystemAudio was used. */
  private audioContext: AudioContext | null = null;
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

  async start(onSegmentReady: SegmentReadyHandler, options: StartOptions = {}): Promise<void> {
    this.onSegmentReady = onSegmentReady;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? `Couldn't access the microphone: ${err.message}`
          : "Couldn't access the microphone. Check your browser's permission settings."
      );
    }

    if (options.includeSystemAudio) {
      if (typeof navigator.mediaDevices.getDisplayMedia !== "function") {
        this.micStream.getTracks().forEach((t) => t.stop());
        this.micStream = null;
        throw new Error(
          'This browser doesn\'t support sharing tab/system audio. Uncheck "Also record the ' +
            'other side of an online call" and try again, or use a recent Chrome/Edge on desktop.'
        );
      }

      let displayStream: MediaStream;
      try {
        // video: true is required to make the browser show the share picker at all --
        // the video track is stopped and discarded immediately below. Only its audio
        // track (if the user shared one) is kept.
        displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch {
        this.micStream.getTracks().forEach((t) => t.stop());
        this.micStream = null;
        throw new Error(
          "Screen/tab sharing was cancelled or blocked, so system audio couldn't be captured. " +
            'Try again and, in the picker, choose the browser tab your meeting is running in ' +
            'with "Share tab audio" checked -- or uncheck the system-audio option to record ' +
            "from the microphone only."
        );
      }

      displayStream.getVideoTracks().forEach((t) => t.stop());
      const systemAudioTracks = displayStream.getAudioTracks();

      if (systemAudioTracks.length === 0) {
        displayStream.getTracks().forEach((t) => t.stop());
        this.micStream.getTracks().forEach((t) => t.stop());
        this.micStream = null;
        throw new Error(
          'No audio was shared. In the picker, choose the browser tab your meeting is running ' +
            'in (not a window or your whole screen) and check "Share tab audio," then try again.'
        );
      }

      this.displayStream = new MediaStream(systemAudioTracks);
      systemAudioTracks[0].addEventListener("ended", () => options.onSystemAudioEnded?.());

      this.audioContext = new AudioContext();
      await this.audioContext.resume().catch(() => {});
      const destination = this.audioContext.createMediaStreamDestination();
      this.audioContext.createMediaStreamSource(this.micStream).connect(destination);
      this.audioContext.createMediaStreamSource(this.displayStream).connect(destination);
      this.stream = destination.stream;
    } else {
      this.stream = this.micStream;
    }

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

    // Stop the real hardware/share tracks individually -- when includeSystemAudio was
    // used, `this.stream` is a synthetic stream generated by the AudioContext graph, and
    // stopping its own track doesn't release the microphone or the shared tab/screen (the
    // browser's "sharing" indicator would otherwise keep showing after the recording ends).
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.displayStream?.getTracks().forEach((track) => track.stop());
    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
    }
    this.micStream = null;
    this.displayStream = null;
    this.audioContext = null;
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
