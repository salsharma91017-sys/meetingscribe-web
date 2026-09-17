"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteRecording,
  getRecording,
  getSegments,
  listTemplates,
  saveRecording,
} from "@/lib/db";
import { RecordingMeta, RecordingSegment, Template } from "@/lib/types";
import { formatElapsed } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { readJsonResponse } from "@/lib/apiResponse";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  ShareIcon,
} from "./icons";
import BrandHeader from "./BrandHeader";

type Tab = "report" | "transcript";

export default function RecordingDetail({
  recordingId,
  onBack,
  onDeleted,
}: {
  recordingId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("report");

  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const playingIndexRef = useRef(0);
  const [playingIndex, setPlayingIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [segTime, setSegTime] = useState(0);

  useEffect(() => {
    (async () => {
      const [m, segs] = await Promise.all([getRecording(recordingId), getSegments(recordingId)]);
      setMeta(m ?? null);
      setSegments(segs);
      setLoading(false);
    })();

    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [recordingId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setSegTime(audio.currentTime);
    const handleEnded = () => {
      const nextIndex = playingIndexRef.current + 1;
      if (nextIndex < segments.length) {
        loadSegmentIntoAudio(nextIndex);
        audio.play().catch(() => {});
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  function loadSegmentIntoAudio(index: number) {
    const audio = audioRef.current;
    const segment = segments[index];
    if (!audio || !segment) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(segment.blob);
    objectUrlRef.current = url;
    audio.src = url;
    playingIndexRef.current = index;
    setPlayingIndex(index);
    setSegTime(0);
  }

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio || segments.length === 0) return;
    if (!audio.src) loadSegmentIntoAudio(0);
    try {
      if (audio.paused) {
        await audio.play();
        setIsPlaying(true);
      } else {
        audio.pause();
        setIsPlaying(false);
      }
    } catch {
      // Autoplay can be blocked until a user gesture; this call is itself one.
    }
  }

  function skipToSegment(index: number) {
    if (index < 0 || index >= segments.length) return;
    const wasPlaying = isPlaying;
    loadSegmentIntoAudio(index);
    if (wasPlaying) audioRef.current?.play().catch(() => {});
  }

  async function openTemplatePicker() {
    const list = await listTemplates();
    setTemplates(list);
    setShowTemplatePicker(true);
  }

  async function generateReport(template: Template) {
    if (!meta) return;
    setShowTemplatePicker(false);
    setProcessing(true);
    setProcessingStatus(segments.length > 0 ? `Transcribing part 1 of ${segments.length}…` : "Transcribing…");

    try {
      const transcriptParts: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        setProcessingStatus(`Transcribing part ${i + 1} of ${segments.length}…`);
        const segment = segments[i];
        const ext = segment.mimeType.includes("mp4")
          ? "mp4"
          : segment.mimeType.includes("ogg")
          ? "ogg"
          : "webm";
        // Vercel rejects any request body over 4.5MB before the app's own code
        // even runs, returning a non-JSON platform error page. Catch an
        // oversized segment here (should be rare given how SegmentedRecorder is
        // tuned, but browsers vary) with a clear message instead of sending an
        // upload that's guaranteed to fail confusingly.
        if (segment.blob.size > 4_300_000) {
          throw new Error(
            `Part ${i + 1} of this recording is too large to upload (${(segment.blob.size / 1_000_000).toFixed(1)}MB, over the 4.5MB server limit). This shouldn't happen with recordings made after the latest update -- try re-recording.`
          );
        }

        const form = new FormData();
        form.append("file", segment.blob, `segment-${i}.${ext}`);

        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        let data: { text?: string };
        try {
          data = await readJsonResponse(res);
        } catch (e) {
          const detail = e instanceof Error ? e.message : "Unknown error";
          throw new Error(`Transcription failed for part ${i + 1}: ${detail}`);
        }
        transcriptParts.push(String(data.text ?? ""));
      }
      const transcript = transcriptParts.join("\n\n").trim();

      setProcessingStatus("Writing report…");
      const reportRes = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, templateInstructions: template.instructions }),
      });
      let reportData: { report?: string; title?: string };
      try {
        reportData = await readJsonResponse(reportRes);
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Unknown error";
        throw new Error(`Report generation failed: ${detail}`);
      }

      const generatedTitle =
        typeof reportData.title === "string" && reportData.title.trim()
          ? reportData.title.trim()
          : null;

      const updated: RecordingMeta = {
        ...meta,
        title: generatedTitle ?? meta.title,
        status: "done",
        transcript,
        reportMarkdown: String(reportData.report ?? ""),
        templateIdUsed: template.id,
        errorMessage: undefined,
      };
      await saveRecording(updated);
      setMeta(updated);
      setActiveTab("report");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const updated: RecordingMeta = { ...meta, status: "error", errorMessage: message };
      await saveRecording(updated);
      setMeta(updated);
    } finally {
      setProcessing(false);
    }
  }

  function currentTabContent(): string {
    if (!meta) return "";
    if (activeTab === "report") return meta.reportMarkdown ?? "No report yet.";
    return meta.transcript ?? "No transcript yet.";
  }

  async function handleShare() {
    const text = currentTabContent();
    const title = `${meta?.title ?? "Meeting"} — ${activeTab === "report" ? "Report" : "Transcript"}`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text });
        return;
      } catch {
        // fall through to clipboard copy
      }
    }
    await handleCopy();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentTabContent());
      alert("Copied to clipboard");
    } catch {
      alert("Couldn't copy — your browser may be blocking clipboard access.");
    }
  }

  function handleDownload() {
    const blob = new Blob([currentTabContent()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = (meta?.title ?? "meeting").replace(/[^a-z0-9-_]+/gi, "-");
    a.download = `${safeTitle}-${activeTab}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleRename() {
    if (!meta) return;
    const newTitle = window.prompt("Rename recording", meta.title);
    if (!newTitle || !newTitle.trim()) return;
    const updated = { ...meta, title: newTitle.trim() };
    await saveRecording(updated);
    setMeta(updated);
  }

  async function handleDelete() {
    if (!meta) return;
    if (!window.confirm("Delete this recording? This removes the audio, transcript, and report.")) return;
    await deleteRecording(meta.id);
    onDeleted();
  }

  if (loading) {
    return <div className="p-6 text-center text-slate-500">Loading…</div>;
  }

  if (!meta) {
    return (
      <div className="p-6 text-center text-slate-500">
        Recording not found.
        <div className="mt-4">
          <button onClick={onBack} className="text-accent-light font-medium">
            Go back
          </button>
        </div>
      </div>
    );
  }

  const hasContent = Boolean(meta.reportMarkdown || meta.transcript);
  const currentSegment = segments[playingIndex];

  return (
    <div className="min-h-screen pb-10 bg-grid">
      <BrandHeader
        title={meta.title}
        onBack={onBack}
        right={
          <>
            <button
              onClick={handleRename}
              className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition text-slate-200"
            >
              Rename
            </button>
            <button
              onClick={handleDelete}
              className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition text-slate-400 hover:text-red-400"
            >
              Delete
            </button>
          </>
        }
      />

      <main className="px-4 pt-6 max-w-2xl mx-auto">
        {/* Playback */}
        <div className="glass-card rounded-xl p-4 flex items-center gap-3">
          <button
            onClick={() => skipToSegment(playingIndex - 1)}
            disabled={playingIndex <= 0}
            aria-label="Previous segment"
            className="text-slate-400 disabled:opacity-30 text-xl hover:text-slate-200 transition"
          >
            <ChevronLeftIcon />
          </button>

          <button
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="w-11 h-11 rounded-full bg-brand-gradient text-white flex items-center justify-center text-xl shrink-0 shadow-glow-blue"
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>

          <button
            onClick={() => skipToSegment(playingIndex + 1)}
            disabled={playingIndex >= segments.length - 1}
            aria-label="Next segment"
            className="text-slate-400 disabled:opacity-30 text-xl hover:text-slate-200 transition"
          >
            <ChevronRightIcon />
          </button>

          <div className="flex-1 text-xs text-slate-500 text-right">
            {segments.length > 1 && <div>Part {playingIndex + 1} of {segments.length}</div>}
            <div>
              {formatElapsed(segTime * 1000)}
              {currentSegment ? ` / ${formatElapsed(currentSegment.durationMs)}` : ""} · total {formatElapsed(meta.durationMs)}
            </div>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio ref={audioRef} className="hidden" />
        </div>

        {/* Generate report */}
        <button
          onClick={openTemplatePicker}
          disabled={processing}
          className="w-full mt-4 bg-brand-gradient hover:brightness-110 disabled:opacity-60 text-white rounded-lg py-2.5 font-medium transition shadow-glow-blue"
        >
          {meta.reportMarkdown ? "Regenerate report" : "Generate report"}
        </button>

        {processing && (
          <div className="mt-4 flex items-center gap-3 text-sm text-slate-400">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
            {processingStatus}
          </div>
        )}

        {meta.status === "error" && meta.errorMessage && (
          <p className="mt-4 text-sm text-red-400">Something went wrong: {meta.errorMessage}</p>
        )}

        {/* Tabs + content */}
        {hasContent && (
          <>
            <div className="mt-6 flex border-b border-white/10">
              <button
                onClick={() => setActiveTab("report")}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                  activeTab === "report"
                    ? "border-accent text-accent-light"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                Report
              </button>
              <button
                onClick={() => setActiveTab("transcript")}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                  activeTab === "transcript"
                    ? "border-accent text-accent-light"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                Transcript
              </button>
            </div>

            <div className="mt-4 glass-card rounded-xl p-4">
              {activeTab === "report" ? (
                <div
                  className="markdown-body text-sm"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(meta.reportMarkdown ?? "No report yet.") }}
                />
              ) : (
                <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {meta.transcript ?? "No transcript yet."}
                </p>
              )}
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={handleShare}
                className="flex-1 border border-white/15 text-slate-200 rounded-lg py-2.5 font-medium hover:bg-white/5 transition flex items-center justify-center gap-2"
              >
                <ShareIcon /> Share
              </button>
              <button
                onClick={handleCopy}
                className="flex-1 border border-white/15 text-slate-200 rounded-lg py-2.5 font-medium hover:bg-white/5 transition flex items-center justify-center gap-2"
              >
                <CopyIcon /> Copy
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 border border-white/15 text-slate-200 rounded-lg py-2.5 font-medium hover:bg-white/5 transition flex items-center justify-center gap-2"
              >
                <DownloadIcon /> Save
              </button>
            </div>
          </>
        )}
      </main>

      {showTemplatePicker && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-20 p-4">
          <div className="glass-card rounded-xl shadow-glow w-full max-w-sm p-4">
            <h2 className="text-base font-semibold text-slate-100 mb-3">Choose a report template</h2>
            <ul className="space-y-2">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => generateReport(t)}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-white/10 hover:border-accent/50 hover:bg-white/5 transition"
                  >
                    <div className="font-medium text-slate-100">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.isBuiltIn ? "Built-in" : "Custom"}</div>
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setShowTemplatePicker(false)}
              className="w-full mt-3 text-sm text-slate-500 hover:text-slate-300 py-2 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
