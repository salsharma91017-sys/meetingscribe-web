"use client";

import { useEffect, useRef, useState } from "react";
import { SegmentedRecorder, RecorderState } from "@/lib/audio";
import { addSegment, saveRecording, deleteRecording } from "@/lib/db";
import { RecordingMeta } from "@/lib/types";
import { formatElapsed } from "@/lib/format";
import { MicIcon, StopIcon } from "./icons";
import BrandHeader from "./BrandHeader";

export default function Recorder({
  onDone,
  onCancel,
}: {
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [includeSystemAudio, setIncludeSystemAudio] = useState(false);
  // Computed in an effect (not at initial render) so server-rendered HTML and the
  // first client render match -- `navigator` isn't available during SSR, and getting
  // this wrong would trigger a hydration mismatch on the checkbox's disabled state.
  const [systemAudioSupported, setSystemAudioSupported] = useState(false);
  const [systemAudioNotice, setSystemAudioNotice] = useState<string | null>(null);

  useEffect(() => {
    setSystemAudioSupported(
      typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function"
    );
  }, []);

  const recorderRef = useRef<SegmentedRecorder | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const segmentCountRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // If the user navigates away mid-recording, make sure the mic is released.
      if (recorderRef.current && recorderRef.current.getState() !== "idle") {
        recorderRef.current.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tick() {
    const recorder = recorderRef.current;
    if (recorder && recorder.getState() !== "idle") {
      setElapsedMs(recorder.getElapsedMs());
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  async function handleStart() {
    setError(null);
    setSystemAudioNotice(null);
    const id = crypto.randomUUID();
    recordingIdRef.current = id;
    segmentCountRef.current = 0;

    const recorder = new SegmentedRecorder();
    recorderRef.current = recorder;

    try {
      await recorder.start(
        (blob, durationMs, index) => {
          segmentCountRef.current = index + 1;
          addSegment({
            id: `${id}::${index}`,
            recordingId: id,
            index,
            blob,
            durationMs,
            mimeType: recorder.getMimeType(),
          }).catch((e) => console.error("Failed to save recording segment", e));
        },
        {
          includeSystemAudio,
          onSystemAudioEnded: () =>
            setSystemAudioNotice(
              "Tab/system audio sharing stopped — still recording your microphone."
            ),
        }
      );
      setState("recording");
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      // SegmentedRecorder.start() already throws clear, user-facing messages for every
      // failure mode (mic permission, display-media cancelled, no audio track shared, ...).
      setError(e instanceof Error ? e.message : "Couldn't start recording. Check your browser's permission settings.");
    }
  }

  function handlePauseResume() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.getState() === "recording") {
      recorder.pause();
      setState("paused");
    } else if (recorder.getState() === "paused") {
      recorder.resume();
      setState("recording");
    }
  }

  async function handleStop() {
    const recorder = recorderRef.current;
    const id = recordingIdRef.current;
    if (!recorder || !id || busy) return;
    setBusy(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    await recorder.stop();
    const finalElapsedMs = recorder.getElapsedMs();

    if (segmentCountRef.current === 0) {
      setBusy(false);
      onCancel();
      return;
    }

    const meta: RecordingMeta = {
      id,
      title: new Date().toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      createdAt: Date.now(),
      durationMs: finalElapsedMs,
      status: "recorded",
      segmentCount: segmentCountRef.current,
    };
    await saveRecording(meta);
    setBusy(false);
    onDone(id);
  }

  async function handleDiscard() {
    if (busy) return;
    setBusy(true);
    const recorder = recorderRef.current;
    const id = recordingIdRef.current;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (recorder && recorder.getState() !== "idle") {
      await recorder.stop().catch(() => {});
    }
    if (id) await deleteRecording(id).catch(() => {});
    setBusy(false);
    onCancel();
  }

  function handleBack() {
    if (state === "idle") {
      onCancel();
    } else {
      handleDiscard();
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-grid">
      <BrandHeader title="New recording" onBack={handleBack} />

      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
        <div className="text-6xl font-mono font-bold gradient-text tabular-nums">
          {formatElapsed(elapsedMs)}
        </div>
        <div className="text-sm text-slate-400 flex items-center gap-2">
          {state === "recording" && (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse-slow" />
          )}
          {state === "idle" && "Tap to start recording"}
          {state === "recording" && "Recording…"}
          {state === "paused" && "Paused"}
        </div>

        {state === "idle" && (
          <label className="flex items-start gap-2 max-w-xs text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSystemAudio}
              disabled={!systemAudioSupported}
              onChange={(e) => setIncludeSystemAudio(e.target.checked)}
              className="mt-0.5 accent-accent disabled:opacity-40"
            />
            <span className={systemAudioSupported ? "" : "opacity-50"}>
              Also record the other side of an online call (share tab/system audio) — use this
              if you're on earphones for a Zoom/Meet/Teams call, since your mic alone won't pick
              up what's only playing into your ears.
              {!systemAudioSupported && " Not supported in this browser — try a recent Chrome or Edge on desktop."}
            </span>
          </label>
        )}

        {includeSystemAudio && state === "idle" && systemAudioSupported && (
          <p className="text-xs text-slate-500 text-center max-w-xs">
            You'll be asked to share a screen/tab next — for the most reliable result, pick the
            browser tab your meeting is running in and check &quot;Share tab audio.&quot;
          </p>
        )}

        {systemAudioNotice && (
          <p className="text-xs text-amber-400 text-center max-w-xs">{systemAudioNotice}</p>
        )}

        {error && (
          <p className="text-sm text-red-400 text-center max-w-xs">{error}</p>
        )}

        <button
          onClick={state === "idle" ? handleStart : handleStop}
          disabled={busy}
          aria-label={state === "idle" ? "Start recording" : "Stop and save"}
          className="w-28 h-28 rounded-full bg-brand-gradient hover:brightness-110 disabled:opacity-60 text-white flex items-center justify-center text-4xl shadow-glow-blue transition"
        >
          {state === "idle" ? <MicIcon /> : <StopIcon />}
        </button>

        {state !== "idle" && (
          <button
            onClick={handlePauseResume}
            disabled={busy}
            className="border border-white/15 text-slate-200 rounded-full px-6 py-2 font-medium hover:bg-white/5 transition"
          >
            {state === "recording" ? "Pause" : "Resume"}
          </button>
        )}

        {state !== "idle" && (
          <button
            onClick={handleDiscard}
            disabled={busy}
            className="text-red-400 text-sm font-medium underline-offset-2 hover:underline"
          >
            Discard
          </button>
        )}
      </main>
    </div>
  );
}
