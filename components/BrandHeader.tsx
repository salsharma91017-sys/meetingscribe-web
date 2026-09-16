"use client";

import { BackIcon } from "./icons";

export default function BrandHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-ink-900/80 backdrop-blur-xl">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="text-slate-300 hover:text-white transition text-xl shrink-0"
          >
            <BackIcon />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/korevia-logo.png"
          alt="KoreVia Solutions"
          className="w-8 h-8 rounded-lg object-cover shadow-glow-blue shrink-0"
        />
        <h1 className="text-base font-semibold truncate flex-1 gradient-text">{title}</h1>
        {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
      </div>
    </header>
  );
}
