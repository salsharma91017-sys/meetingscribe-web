"use client";

import { useState } from "react";
import { RecordingMeta } from "@/lib/types";
import { formatDate, formatElapsed } from "@/lib/format";
import { MicIcon } from "./icons";
import BrandHeader from "./BrandHeader";

const STATUS_LABEL: Record<RecordingMeta["status"], { text: string; className: string }> = {
  recorded: { text: "Recorded", className: "text-amber-400" },
  transcribing: { text: "Transcribing…", className: "text-amber-400" },
  writing_report: { text: "Writing report…", className: "text-amber-400" },
  done: { text: "Report ready", className: "text-accent-light" },
  error: { text: "Error", className: "text-red-400" },
};

export default function RecordingsList({
  recordings,
  onSelect,
  onNewRecording,
  onOpenTemplates,
}: {
  recordings: RecordingMeta[];
  onSelect: (id: string) => void;
  onNewRecording: () => void;
  onOpenTemplates: () => void;
}) {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <div className="min-h-screen pb-28 bg-grid">
      <BrandHeader
        title="KoreVia MeetingScribe"
        right={
          <>
            <button
              onClick={onOpenTemplates}
              className="text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition text-slate-200"
            >
              Templates
            </button>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              Logout
            </button>
          </>
        }
      />

      <main className="px-4 pt-6">
        {recordings.length === 0 ? (
          <div className="flex flex-col items-center text-center mt-20 px-6">
            <div className="w-16 h-16 rounded-2xl bg-brand-gradient-soft border border-white/10 flex items-center justify-center text-2xl text-accent-light shadow-glow mb-4">
              <MicIcon />
            </div>
            <h2 className="text-lg font-semibold text-slate-100">No recordings yet</h2>
            <p className="mt-2 text-sm text-slate-500 max-w-xs">
              Tap the mic button below to record your first meeting — KoreVia's AI will
              transcribe it and write the report for you.
            </p>
          </div>
        ) : (
          <ul className="space-y-3 max-w-2xl mx-auto">
            {recordings.map((r) => {
              const status = STATUS_LABEL[r.status];
              return (
                <li key={r.id}>
                  <button
                    onClick={() => onSelect(r.id)}
                    className="w-full text-left glass-card rounded-xl p-4 hover:border-accent/40 hover:shadow-glow transition"
                  >
                    <div className="font-semibold text-slate-100 truncate">{r.title}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {formatDate(r.createdAt)} · {formatElapsed(r.durationMs)}
                    </div>
                    <div className={`text-xs font-semibold mt-2 ${status.className}`}>{status.text}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <button
        onClick={onNewRecording}
        aria-label="New recording"
        className="fixed bottom-6 right-6 bg-brand-gradient hover:brightness-110 text-white rounded-full w-16 h-16 shadow-glow-blue flex items-center justify-center text-2xl transition animate-float"
      >
        <MicIcon />
      </button>
    </div>
  );
}
