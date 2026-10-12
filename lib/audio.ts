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
  /** A specific microphone to record from (a `deviceId` from enumerateDevices()).
   *  Omit to use the browser's default input. */
  micDeviceId?: string;
  /** "Room meeting mode" -- see buildMicConstraints() for exactly what this changes. */
  roomMode?: boolean;
}

export interface MicSettings {
  deviceId?: string;
  roomMode?: boolean;
}

/** The getUserMedia constraints for a given set of mic settings.
 *
 *  By default browsers apply call-style voice processing to the mic: noise suppression,
 *  echo cancellation and automatic gain. That's right for a video call, but noise
 *  suppression decides what counts as "noise" by loudness and distance -- so in a room
 *  full of people, quieter or further-away speakers are exactly what it tends to attenuate.
 *  Room mode turns noise suppression off (and echo cancellation too, unless a call's audio
 *  is also being captured, where it stays on so a speaker-fed mic doesn't echo it back).
 *  Auto gain stays on in both modes: it lifts quiet voices, which is the point here.
 *
 *  The trade-off is more background noise in the recording. Whether that's a net win depends
 *  on the room, which is why it's an option and not the default. */
export function buildMicConstraints(
  settings: MicSettings,
  includeSystemAudio = false
): MediaStreamConstraints {
  const roomMode = Boolean(settings.roomMode);
  const audio: MediaTrackConstraints = {
    noiseSuppression: !roomMode,
    echoCancellation: roomMode && !includeSystemAudio ? false : true,
    autoGainControl: true,
  };
  if (settings.deviceId) audio.deviceId = { exact: settings.deviceId };
  return { audio };
}

/** Opens the microphone with the given settings, turning the browser's raw errors into
 *  messages that say what to do about them. */
export async function openMicrophone(
  settings: MicSettings,
  includeSystemAudio = false
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(
      buildMicConstraints(settings, includeSystemAudio)
    );
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (settings.deviceId && (name === "OverconstrainedError" || name === "NotFoundError")) {
      throw new Error(
        "The selected microphone isn't available any more (unplugged, disabled, or in use " +
          "elsewhere). Pick another one from the list and try again."
      );
    }
    throw new Error(
      err instanceof Error
        ? `Couldn't access the microphone: ${err.message}`
        : "Couldn't access the microphone. Check your browser's permission settings."
    );
  }
}

/** Maps a raw RMS amplitude (0..1) onto a 0..1 meter position: -60 dBFS (or quieter) is 0
 *  and 0 dBFS is 1. Normal speech into a decent mic lands roughly in the middle of that range,
 *  and a mic that's muted or on the wrong device sits near 0. */
export function rmsToLevel(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/** Reads the live input level of a stream, for a volume meter. Connects the stream to an
 *  AnalyserNode only -- never to the speakers -- so it can't cause feedback. */
export class LevelMeter {
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private buffer: Float32Array<ArrayBuffer>;

  constructor(
    stream: MediaStream,
    private ctx: AudioContext,
    private ownsContext: boolean
  ) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.source = ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
  }

  /** A meter with its own AudioContext (closed again by dispose()). */
  static create(stream: MediaStream): LevelMeter {
    const ctx = new AudioContext();
    ctx.resume().catch(() => {});
    return new LevelMeter(stream, ctx, true);
  }

  /** Current level, 0..1 (see rmsToLevel). */
  getLevel(): number {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sumSquares = 0;
    for (let i = 0; i < this.buffer.length; i++) sumSquares += this.buffer[i] * this.buffer[i];
    return rmsToLevel(Math.sqrt(sumSquares / this.buffer.length));
  }

  dispose(): void {
    try {
      this.source.disconnect();
    } catch {
      // already disconnected
    }
    if (this.ownsContext) this.ctx.close().catch(() => {});
  }
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
  /** Live input level of the microphone, for the on-screen meter. Nice-to-have only: if it
   *  can't be set up, recording carries on without it. */
  private meter: LevelMeter | null = null;
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

    this.micStream = await openMicrophone(
      { deviceId: options.micDeviceId, roomMode: options.roomMode },
      Boolean(options.includeSystemAudio)
    );

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

    try {
      this.meter = this.audioContext
        ? new LevelMeter(this.micStream, this.audioContext, false)
        : LevelMeter.create(this.micStream);
    } catch {
      this.meter = null;
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
    this.meter?.dispose();
    this.meter = null;
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

  /** Current microphone level 0..1 (see rmsToLevel), or null if no meter is available. */
  getInputLevel(): number | null {
    return this.meter ? this.meter.getLevel() : null;
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
