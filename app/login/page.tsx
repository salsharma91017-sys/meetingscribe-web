"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Incorrect username or password.");
        setBusy(false);
        return;
      }
      const next = searchParams.get("next") || "/";
      router.push(next);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-grid">
      <div className="w-full max-w-md">
        {/* Hero / brand block */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="relative mb-5">
            <div className="absolute inset-0 rounded-3xl bg-brand-gradient blur-2xl opacity-50 animate-pulse-slow" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/korevia-logo.png"
              alt="KoreVia Solutions"
              className="relative w-24 h-24 rounded-3xl object-cover shadow-glow-blue animate-float"
            />
          </div>
          <h1 className="text-2xl font-bold text-slate-50">
            KoreVia <span className="gradient-text">MeetingScribe</span>
          </h1>
          <p className="mt-2 text-sm text-slate-400 max-w-sm">
            AI-powered meeting recording &amp; reporting, built by{" "}
            <span className="text-slate-200 font-medium">KoreVia Solutions</span>.
          </p>
        </div>

        {/* Login card */}
        <form onSubmit={handleSubmit} className="glass-card rounded-2xl p-6 shadow-glow">
          <h2 className="text-sm font-semibold text-slate-200 mb-4 tracking-wide uppercase">
            Sign in to continue
          </h2>

          <label className="flex flex-col gap-1.5 mb-4">
            <span className="text-xs font-medium text-slate-400">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="bg-ink-800/80 border border-white/10 rounded-lg px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/60 transition"
              placeholder="Enter username"
            />
          </label>

          <label className="flex flex-col gap-1.5 mb-5">
            <span className="text-xs font-medium text-slate-400">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="bg-ink-800/80 border border-white/10 rounded-lg px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/60 transition"
              placeholder="Enter password"
            />
          </label>

          {error && (
            <p className="text-sm text-red-400 mb-4" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-brand-gradient disabled:opacity-60 text-white rounded-lg py-2.5 font-semibold shadow-glow-blue hover:brightness-110 transition"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* About KoreVia */}
        <div className="glass-card rounded-2xl p-6 mt-6">
          <h3 className="text-xs font-semibold text-slate-400 tracking-wide uppercase mb-2">
            About KoreVia Solutions
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            KoreVia Solutions builds AI automation and backend data processing systems that turn
            slow, manual work into fast, reliable pipelines. We're leading the way as AI-powered
            developers — pairing modern AI models with solid engineering to optimize processes,
            drive efficiency, and deliver impact for the businesses we work with.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Technology • Automation • Intelligence
          </p>
          <p className="mt-3 text-xs text-slate-500">
            <a
              href="https://korevia.solutions/"
              target="_blank"
              rel="noreferrer"
              className="text-accent-light hover:underline"
            >
              korevia.solutions
            </a>
          </p>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Internal tool — access is limited to KoreVia Solutions.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
