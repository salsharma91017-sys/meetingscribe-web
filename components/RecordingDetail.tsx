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
  PdfIcon,
  PlayIcon,
  ShareIcon,
} from "./icons";
import BrandHeader from "./BrandHeader";

type Tab = "report" | "transcript";

// Shown on the branded PDF export only (see the hidden "print view" near the bottom of the
// component and handleExportPdf()) -- kept in the same voice as the "About KoreVia Solutions"
// blurb on the login page, but focused on MeetingScribe itself.
const MEETINGSCRIBE_BLURB =
  "MeetingScribe is KoreVia Solutions' AI-powered meeting companion. It records your " +
  "conversations, transcribes them automatically, and turns them into clear, structured " +
  "reports — so nothing important gets lost, and meetings are easier to manage, revisit, " +
  "and act on.";

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
  const [forceRetranscribe, setForceRetranscribe] = useState(false);

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

    // If this recording already has a transcript (e.g. you're trying a different
    // template, or regenerating after a failed report), reuse it instead of
    // re-transcribing the audio from scratch every time -- that's slower, costs an
    // OpenAI call per segment for no reason, and is exactly what's skipped here unless
    // you explicitly asked to re-transcribe.
    const reuseExistingTranscript = Boolean(meta.transcript && meta.transcript.trim()) && !forceRetranscribe;
    setForceRetranscribe(false);

    setProcessingStatus(
      reuseExistingTranscript
        ? "Using existing transcript…"
        : segments.length > 0
        ? `Transcribing part 1 of ${segments.length}…`
        : "Transcribing…"
    );

    try {
      let transcript: string;
      if (reuseExistingTranscript) {
        transcript = meta.transcript!.trim();
      } else {
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
        transcript = transcriptParts.join("\n\n").trim();
      }

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

  function handleExportPdf() {
    if (typeof window === "undefined") return;
    // The browser's own "Save as PDF" print target is used instead of a client-side PDF
    // library (jsPDF, etc.) -- it produces a real, selectable-text PDF with correct
    // pagination for free, and needs no extra dependency or server-side rendering step.
    // The hidden .print-view block below (shown only under the @media print / Tailwind
    // print: rules) is what actually gets printed; document.title is used as the
    // filename Chrome/Edge suggest in the save dialog, so it's set to something more
    // useful than the app's own tab title just for this call.
    const previousTitle = document.title;
    const safeTitle = (meta?.title ?? "Meeting").trim();
    document.title = `${safeTitle} - MeetingScribe Report`;
    window.print();
    document.title = previousTitle;
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
    <>
      {/* print:hidden -- the whole interactive app shell is hidden during the PDF export
          print pass (handleExportPdf()); the branded print view further below is what
          actually gets shown/printed instead. Needs its own fragment wrapper since a
          print:hidden ancestor would also hide that print view if it were nested inside. */}
      <div className="min-h-screen pb-10 bg-grid print:hidden">
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

            {meta.reportMarkdown && meta.reportMarkdown.trim() && (
              <button
                onClick={handleExportPdf}
                className="w-full mt-3 border border-white/15 text-slate-200 rounded-lg py-2.5 font-medium hover:bg-white/5 transition flex items-center justify-center gap-2"
              >
                <PdfIcon /> Export report as PDF
              </button>
            )}
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

            {meta.transcript && meta.transcript.trim() && (
              <label className="flex items-start gap-2 mt-3 px-1 text-xs text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceRetranscribe}
                  onChange={(e) => setForceRetranscribe(e.target.checked)}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  Re-transcribe from audio instead of reusing the existing transcript
                  (slower — only needed if you think the transcript is wrong).
                </span>
              </label>
            )}

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

      {/* Branded "print view" for PDF export -- invisible on screen (Tailwind's `hidden`),
          shown only for the browser's print/save-as-PDF pass (`print:block`), and NOT the
          same markup as the on-screen report: it always shows meta.reportMarkdown
          specifically (regardless of which tab is active) with the KoreVia logo and the
          MeetingScribe blurb, styled for a printed white page. See handleExportPdf(). Sits
          outside the print:hidden app-shell div above (as a fragment sibling), since a
          print:hidden ancestor would hide this too, however this element is styled. */}
      <div className="hidden print:block bg-white text-black p-2 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 border-b border-slate-300 pb-4 mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/korevia-logo.png" alt="KoreVia Solutions" className="w-12 h-12 rounded-lg object-cover" />
          <div>
            <div className="text-lg font-bold text-slate-900">
              KoreVia <span className="font-black">MeetingScribe</span>
            </div>
            <div className="text-[11px] text-slate-500">AI-powered meeting reports by KoreVia Solutions</div>
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed italic mb-6">{MEETINGSCRIBE_BLURB}</p>

        <h1 className="text-xl font-bold text-slate-900 mb-1">{meta.title}</h1>
        <p className="text-xs text-slate-500 mb-6">
          Recorded {new Date(meta.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          {" · "}Duration {formatElapsed(meta.durationMs)}
        </p>

        <div
          className="print-markdown-body text-[13px]"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(meta.reportMarkdown ?? "No report yet.") }}
        />

        <div className="mt-10 pt-4 border-t border-slate-200 text-[10px] text-slate-400 text-center">
          Generated by KoreVia MeetingScribe · korevia.solutions
        </div>
      </div>
    </>
  );
}
