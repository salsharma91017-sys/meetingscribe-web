"use client";

import { useEffect, useRef, useState } from "react";
import { SegmentedRecorder, RecorderState, LevelMeter, openMicrophone } from "@/lib/audio";
import { addSegment, saveRecording, deleteRecording } from "@/lib/db";
import { RecordingMeta } from "@/lib/types";
import { formatElapsed } from "@/lib/format";
import { MicIcon, StopIcon } from "./icons";
import BrandHeader from "./BrandHeader";

const MIC_PREF_KEY = "meetingscribe.micDeviceId";
const ROOM_MODE_PREF_KEY = "meetingscribe.roomMode";

// A meter position (see rmsToLevel in lib/audio.ts) below this is ~-57 dBFS or quieter: a
// muted or dead mic, not just a quiet room (with auto gain on, even a quiet room's noise
// floor sits well above this). Held for SILENCE_WARN_MS before warning, so ordinary pauses
// in conversation don't trigger it.
const SILENCE_LEVEL = 0.05;
const SILENCE_WARN_MS = 15_000;

function LevelBar({ level }: { level: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, level)) * 100);
  return (
    <div
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full rounded-full bg-white/10 overflow-hidden"
    >
      <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${pct}%` }} />
    </div>
  );
}

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

  const [micDevices, setMicDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [roomMode, setRoomMode] = useState(false);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [noSoundWarning, setNoSoundWarning] = useState(false);
  const levelRef = useRef(0);
  const silentSinceRef = useRef<number | null>(null);

  // Meter smoothing: jump up instantly, fall back gradually, so a spoken word reads as a
  // visible bump instead of a flicker.
  function smoothLevel(raw: number): number {
    levelRef.current = Math.max(raw, levelRef.current * 0.92);
    return levelRef.current;
  }

  async function refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // Browsers don't reveal device ids/names until the mic permission has been granted, so
      // the list stays empty (just "Default microphone") until then. Chrome also lists
      // "default" and "communications" aliases of real devices, which only add duplicates.
      const inputs = all.filter(
        (d) =>
          d.kind === "audioinput" &&
          d.deviceId &&
          d.deviceId !== "default" &&
          d.deviceId !== "communications"
      );
      setMicDevices(
        inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
      );
      // A remembered mic that's no longer plugged in would make recording fail outright.
      if (inputs.length > 0) {
        setSelectedDeviceId((prev) =>
          prev && !inputs.some((d) => d.deviceId === prev) ? "" : prev
        );
      }
    } catch {
      // enumerateDevices unavailable -- the picker just stays on "Default microphone".
    }
  }

  useEffect(() => {
    try {
      setSelectedDeviceId(localStorage.getItem(MIC_PREF_KEY) ?? "");
      setRoomMode(localStorage.getItem(ROOM_MODE_PREF_KEY) === "1");
    } catch {
      // storage blocked -- defaults are fine
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    refreshDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refreshDevices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMicChange(deviceId: string) {
    setSelectedDeviceId(deviceId);
    try {
      localStorage.setItem(MIC_PREF_KEY, deviceId);
    } catch {
      // ignore
    }
  }

  function handleRoomModeChange(on: boolean) {
    setRoomMode(on);
    try {
      localStorage.setItem(ROOM_MODE_PREF_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  }

  // "Test microphone": opens the mic with exactly the settings a recording would use and
  // shows its live level, so a dead/wrong/too-distant mic is obvious *before* the meeting
  // rather than after. Restarts if the device or mode changes while it's running.
  useEffect(() => {
    if (!testing) return;
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let meter: LevelMeter | null = null;

    (async () => {
      try {
        stream = await openMicrophone(
          { deviceId: selectedDeviceId || undefined, roomMode },
          includeSystemAudio
        );
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        meter = LevelMeter.create(stream);
        refreshDevices(); // names are available now that permission has been granted
        const loop = () => {
          if (meter) setLevel(smoothLevel(meter.getLevel()));
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't access the microphone.");
          setTesting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      meter?.dispose();
      stream?.getTracks().forEach((t) => t.stop());
      levelRef.current = 0;
      setLevel(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testing, selectedDeviceId, roomMode, includeSystemAudio]);

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
      const raw = recorder.getInputLevel();
      if (raw !== null) {
        setLevel(smoothLevel(raw));
        if (recorder.getState() === "recording" && raw < SILENCE_LEVEL) {
          const now = performance.now();
          if (silentSinceRef.current === null) silentSinceRef.current = now;
          else if (now - silentSinceRef.current > SILENCE_WARN_MS) setNoSoundWarning(true);
        } else {
          silentSinceRef.current = null;
          setNoSoundWarning(false);
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  async function handleStart() {
    setError(null);
    setSystemAudioNotice(null);
    setTesting(false);
    levelRef.current = 0;
    silentSinceRef.current = null;
    setNoSoundWarning(false);
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
          micDeviceId: selectedDeviceId || undefined,
          roomMode,
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

        {state !== "idle" && (
          <div className="w-full max-w-xs">
            <div className="text-[11px] text-slate-500 mb-1">Mic level</div>
            <LevelBar level={level} />
          </div>
        )}

        {noSoundWarning && state === "recording" && (
          <p className="text-xs text-amber-400 text-center max-w-xs">
            Almost no signal from the microphone for a while. If people are talking, check the
            mic isn't muted and that the right one is selected — otherwise this recording will
            be mostly empty.
          </p>
        )}

        {state === "idle" && (
          <div className="w-full max-w-xs space-y-3">
            <div>
              <label htmlFor="mic-select" className="block text-xs text-slate-400 mb-1">
                Microphone
              </label>
              <select
                id="mic-select"
                value={selectedDeviceId}
                onChange={(e) => handleMicChange(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 [color-scheme:dark]"
              >
                <option value="">Default microphone</option>
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              {micDevices.length === 0 && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Your other microphones are listed here once the browser has mic access — tap
                  Test microphone below.
                </p>
              )}
            </div>

            <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={roomMode}
                onChange={(e) => handleRoomModeChange(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>
                Room meeting mode — turns off the browser&apos;s noise suppression so quieter,
                more distant voices are less likely to be filtered out. Best for in-person
                meetings; it can let in more background noise.
              </span>
            </label>

            <div>
              <button
                type="button"
                onClick={() => setTesting((t) => !t)}
                className="text-xs border border-white/15 text-slate-200 rounded-full px-4 py-1.5 hover:bg-white/5 transition"
              >
                {testing ? "Stop test" : "Test microphone"}
              </button>
              {testing && (
                <div className="mt-3">
                  <LevelBar level={level} />
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Talk the way people will in the meeting, from where they&apos;ll sit. The bar
                    should move clearly for everyone — if it barely moves for quieter or
                    further-away voices, move the mic closer.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

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
