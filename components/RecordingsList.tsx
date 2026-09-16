"use client";

import { RecordingMeta } from "@/lib/types";
import { formatDate, formatElapsed } from "@/lib/format";
import { MicIcon } from "./icons";

const STATUS_LABEL: Record<RecordingMeta["status"], { text: string; className: string }> = {
  recorded: { text: "Recorded", className: "text-amber-600" },
  transcribing: { text: "Transcribing…", className: "text-amber-600" },
  writing_report: { text: "Writing report…", className: "text-amber-600" },
  done: { text: "Report ready", className: "text-green-700" },
  error: { text: "Error", className: "text-red-600" },
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
  return (
    <div className="min-h-screen pb-28">
      <header className="bg-brand text-white px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <h1 className="text-lg font-semibold">MeetingScribe</h1>
        <button
          onClick={onOpenTemplates}
          className="text-sm font-medium bg-white/15 hover:bg-white/25 rounded-full px-3 py-1.5 transition"
        >
          Templates
        </button>
      </header>

      <main className="px-4 pt-4">
        {recordings.length === 0 ? (
          <div className="flex flex-col items-center text-center mt-24 px-6">
            <h2 className="text-lg font-semibold text-gray-900">No recordings yet</h2>
            <p className="mt-2 text-sm text-gray-500">
              Tap the mic button below to record your first meeting.
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
                    className="w-full text-left bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition"
                  >
                    <div className="font-semibold text-gray-900 truncate">{r.title}</div>
                    <div className="text-xs text-gray-500 mt-1">
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
        className="fixed bottom-6 right-6 bg-accent hover:bg-red-500 text-white rounded-full w-16 h-16 shadow-lg flex items-center justify-center text-2xl transition"
      >
        <MicIcon />
      </button>
    </div>
  );
}
