"use client";

import { useEffect, useRef, useState } from "react";
import { SegmentedRecorder, RecorderState } from "@/lib/audio";
import { addSegment, saveRecording, deleteRecording } from "@/lib/db";
import { RecordingMeta } from "@/lib/types";
import { formatElapsed } from "@/lib/format";
import { BackIcon, MicIcon, StopIcon } from "./icons";

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
    const id = crypto.randomUUID();
    recordingIdRef.current = id;
    segmentCountRef.current = 0;

    const recorder = new SegmentedRecorder();
    recorderRef.current = recorder;

    try {
      await recorder.start((blob, durationMs, index) => {
        segmentCountRef.current = index + 1;
        addSegment({
          id: `${id}::${index}`,
          recordingId: id,
          index,
          blob,
          durationMs,
          mimeType: recorder.getMimeType(),
        }).catch((e) => console.error("Failed to save recording segment", e));
      });
      setState("recording");
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't access the microphone: ${e.message}`
          : "Couldn't access the microphone. Check your browser's permission settings."
      );
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
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand text-white px-4 py-4 flex items-center gap-3">
        <button onClick={handleBack} aria-label="Back" className="text-xl">
          <BackIcon />
        </button>
        <h1 className="text-lg font-semibold">New recording</h1>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
        <div className="text-5xl font-mono font-bold text-gray-900 tabular-nums">
          {formatElapsed(elapsedMs)}
        </div>
        <div className="text-sm text-gray-500">
          {state === "idle" && "Tap to start recording"}
          {state === "recording" && "Recording…"}
          {state === "paused" && "Paused"}
        </div>

        {error && (
          <p className="text-sm text-red-600 text-center max-w-xs">{error}</p>
        )}

        <button
          onClick={state === "idle" ? handleStart : handleStop}
          disabled={busy}
          aria-label={state === "idle" ? "Start recording" : "Stop and save"}
          className="w-28 h-28 rounded-full bg-accent hover:bg-red-500 disabled:opacity-60 text-white flex items-center justify-center text-4xl shadow-lg transition"
        >
          {state === "idle" ? <MicIcon /> : <StopIcon />}
        </button>

        {state !== "idle" && (
          <button
            onClick={handlePauseResume}
            disabled={busy}
            className="border border-brand text-brand rounded-full px-6 py-2 font-medium hover:bg-brand/5 transition"
          >
            {state === "recording" ? "Pause" : "Resume"}
          </button>
        )}

        {state !== "idle" && (
          <button
            onClick={handleDiscard}
            disabled={busy}
            className="text-red-600 text-sm font-medium underline-offset-2 hover:underline"
          >
            Discard
          </button>
        )}
      </main>
    </div>
  );
}
