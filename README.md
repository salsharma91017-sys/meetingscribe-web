# KoreVia MeetingScribe (web)

Record a meeting in your browser, pause/resume as needed, and turn it into a structured report
(SOAP-style: Subjective / Objective / Assessment / Plan, with action items) once you're done.
Built to live on GitHub and deploy on Vercel with no server to manage. Branded for
**KoreVia Solutions**, with a flashy dark/gradient "AI-powered" theme and a simple built-in
login so it isn't wide open to the public internet.

**This one has actually been built and tested in the environment I wrote it in** — `npm install`
and `npm run build` both succeed with zero errors, and both API routes were exercised against the
real OpenAI and Anthropic endpoints (with a fake key, to confirm the requests are well-formed —
they got back real "invalid API key" responses rather than crashing). It has not been used in a
real browser with a microphone, so give it a real test run after deploying, same as you would any
new tool.

## How it works

- **Record** — the browser's `MediaRecorder` API records straight from your mic. Start, pause,
  resume, stop. To keep uploads small and avoid serverless request-size limits, a long recording
  is automatically split into ~4-minute segments behind the scenes as you go (no gap you'd notice
  — it rotates to a new recorder right as each segment ends). Everything is stored locally in
  your browser (IndexedDB) — nothing is uploaded until you ask for a report.
- **Transcribe** — when you tap "Generate report," each segment is uploaded to `/api/transcribe`,
  a serverless function that forwards it to OpenAI's Whisper API and returns the text. The
  segments are transcribed in order and stitched together. If the recording already has a
  transcript (you're trying a different template, or regenerating after a failure), that step is
  skipped and the existing transcript is reused — faster, and doesn't re-spend an OpenAI call per
  segment for no reason. There's a "Re-transcribe from audio instead" checkbox in the template
  picker for the rare case you actually want a fresh transcription.
- **Report** — the full transcript plus your chosen template goes to `/api/generate-report`,
  which calls Anthropic's Claude API to write the report in Markdown. View the report or the raw
  transcript, copy it, share it (via the OS share sheet on mobile, or clipboard on desktop), or
  download it as a `.md` file.
- **Templates** — four built in: a **SOAP Meeting Note** (Subjective / Objective / Assessment /
  Plan), a **Business Meeting** template (summary, attendees, decisions, action items, next
  steps), a **Project Plan & A–Z Workflow White Paper** — a long, detailed write-up geared at
  planning meetings for a system or product (built with a behaviour support / allied health CRM
  project in mind): it separates what was actually agreed from what was just discussed, walks
  step-by-step through the full workflow being designed, and lists functional/non-functional
  requirements, assumptions, risks, and open questions — written so the whole thing can be pasted
  into a fresh Claude conversation to draft a full product spec from it — and a **CoVet-Style
  Meeting Summary**, modeled on a sample report format (Meeting Details with date/time/attendees,
  Discussion Topics broken into per-topic sub-sections with supporting sub-points, and Action
  Items). **Every template — including the built-in ones — is fully editable**: open it from the
  Templates screen and edit the name or instructions directly; a built-in template has a "Reset
  to default wording" option if you want the original text back. "Duplicate as new template" is
  available on any template too, for making variants without losing the original.
- **Auto-titling** — once a report is generated, the app asks Claude for a short, specific
  meeting title based on what was actually discussed (e.g. "Q3 Budget Review With Finance
  Team") and renames the recording automatically, replacing the generic timestamp title. You
  can still rename it by hand any time with the "Rename" button.

Your OpenAI and Anthropic API keys live only as environment variables on the server (Vercel) —
they're never sent to or stored in the browser.

## Login

The whole app sits behind a simple username/password gate (checked in `middleware.ts`), so a
stranger who finds your deployed URL can't burn your API budget. Both the username and password
default to **`korevia`** / **`korevia`**. To use a stronger password, set the `AUTH_USERNAME`
and `AUTH_PASSWORD` environment variables in Vercel (same place as your API keys) and redeploy.

This is a single shared password, not a real user-accounts system — good enough to keep the
app private to your team, not meant for protecting sensitive data. The session is a signed
cookie valid for 30 days; there's a "Logout" button on the home screen.

## Deploying it

### 1. Push this project to GitHub

```bash
cd meetingscribe-web
git init
git add .
git commit -m "Initial commit"
```

Then create a new repository on GitHub (via the website, or `gh repo create` if you have the
GitHub CLI) and push:

```bash
git remote add origin https://github.com/<your-username>/meetingscribe-web.git
git branch -M main
git push -u origin main
```

### 2. Import it into Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and sign in with GitHub.
2. Pick the `meetingscribe-web` repo. Vercel auto-detects it's a Next.js app — you don't need to
   change any build settings.
3. Before clicking Deploy, open **Environment Variables** and add:
   - `OPENAI_API_KEY` — from <https://platform.openai.com/api-keys>
   - `ANTHROPIC_API_KEY` — from <https://console.anthropic.com>
   - `CLAUDE_MODEL` (optional) — defaults to `claude-sonnet-5` if you leave it out.
     Model names change over time; if report generation ever fails with a "model not found"
     error, check <https://docs.claude.com> for the current ID and set it here.
   - `AUTH_USERNAME` / `AUTH_PASSWORD` (optional) — override the default `korevia` / `korevia`
     login. Skip these if the default is fine for now; add them later any time.
4. Click **Deploy**. A minute or two later you'll have a live URL
   (`meetingscribe-web.vercel.app` or similar).

Any time you push a new commit to `main`, Vercel redeploys automatically. Any time you add or
change an environment variable on an **existing** deployment, you need to trigger a
**Redeploy** (Deployments tab → ⋯ on the latest deployment → Redeploy) for it to take effect —
adding the variable alone doesn't update a build that already ran.

### Running it locally first (optional but recommended)

```bash
npm install
cp .env.example .env.local   # then fill in your API keys
npm run dev
```

Open <http://localhost:3000>. Recording needs microphone access, which browsers only grant on
`localhost` or `https://` — this works for local dev and for the deployed Vercel URL, just not
over plain `http://` on a different machine.

### Fixed: long recordings losing audio at each ~4-minute mark

An earlier version of `lib/audio.ts` had a bug where the automatic segment rotation (the thing
that splits a long recording into ~4-minute chunks behind the scenes) stopped the recorder
without first recording how much time had actually elapsed. That made every segment except the
final one get logged as 0 seconds long, so it was silently discarded — meaning only the last
few minutes of a long meeting actually made it into the transcript — and the on-screen timer
visibly dropped back to ~0:00 every ~4 minutes, making it look like the recording had restarted.
This is now fixed: the timer counts up continuously for the whole recording, and every segment
is captured and included. Verified with an isolated timing test simulating 10+ minutes of
continuous recording, and separately with pause/resume mixed in.

If you recorded any meetings with the earlier version, only their last segment's audio would
have made it into the report — worth re-recording anything important that seemed short.

### Fixed: "Something went wrong: Unexpected token 'A' ... is not valid JSON" during transcription

Vercel enforces a hard **4.5MB request body limit** on every plan (Hobby included) — a request
over that is rejected by Vercel's own gateway, with a plain-text/HTML error page, *before the
app's code ever runs*. At the previous ~4-minute segment length, a recording's audio could land
right at that edge depending on the browser's default bitrate, and when a segment tipped over
the limit, the app tried to parse Vercel's error page as JSON and failed with exactly that
confusing message.

Two changes fix this:

- Segments are now 3 minutes instead of 4, and are recorded at a fixed, modest bitrate
  (64kbps — plenty for clear speech transcription), so a segment's upload size stays well under
  the 4.5MB limit with real headroom to spare.
- If a segment somehow still comes out oversized, the app now catches that *before* uploading
  it and shows a clear message, instead of sending a request that Vercel is guaranteed to
  reject. More generally, every API call now handles a non-JSON response gracefully (this can
  also happen on a gateway timeout) and shows a plain-language reason instead of a raw parsing
  error.

Sources: [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) (request body
size), [FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/function_payload_too_large).

### Changed: default Claude model, and a longer report length limit

Two related changes worth knowing about, found while adding the white-paper template:

- The default report-writing model was `claude-sonnet-4-5-20250929`, which is on Anthropic's
  deprecation path with a tentative API retirement date "not sooner than 2026-09-29" — close
  enough that it was worth switching proactively. The default is now `claude-sonnet-5`, the
  current flagship Sonnet model. If you never set `CLAUDE_MODEL` in Vercel, this update alone
  fixes it on your next redeploy. If you *did* set `CLAUDE_MODEL` explicitly to the old value,
  update or remove it.
- The report length cap (`max_tokens`) was 4096, tight enough to risk truncating a genuinely
  detailed report (like the white paper template). It's now 8000.

### Fixed: "Report generation failed: The request took too long and timed out." on the white paper template

Raising `max_tokens` to generate longer reports (above) initially went to 16000, and the
function's `maxDuration` was only 90s. At Sonnet's typical output speed (~65 tokens/sec), a
response that actually used close to the full 16000-token budget could take up to ~4 minutes on
its own — comfortably longer than 90s, so Vercel killed the function and returned a 504
(`FUNCTION_INVOCATION_TIMEOUT`), which the app correctly reported as a timeout, just not a fun
one to hit while trying out the new template.

Fixed with two changes: `maxDuration` for this route is now 300s (Vercel's own default *and*
maximum on every plan, Hobby included, so this costs nothing extra), and `max_tokens` was
brought back down to 8000 — still double the original limit and enough for one meeting's worth
of genuinely detailed notes (~6000 words), while keeping the realistic worst-case generation
time well under two minutes instead of flirting with the timeout ceiling.

### Added: reusing an existing transcript instead of re-transcribing every time

Every "Generate report" click re-uploaded and re-transcribed every audio segment from scratch,
even when regenerating a report you'd already successfully transcribed once (e.g. trying a
different template). That's slower, spends an OpenAI Whisper call per segment for no reason, and
adds extra round-trips that can each go wrong. Generating a report now skips the transcription
step entirely when the recording already has a transcript, and writes the report directly from
it. A "Re-transcribe from audio instead" checkbox appears in the template picker for the rare
case you actually want a fresh transcription (e.g. you think the existing one is wrong).

Source: [Vercel Functions Limits — Max duration](https://vercel.com/docs/functions/limitations#max-duration).

### Added: the CoVet-Style Meeting Summary template, and topic sub-headings / nested bullets

Added a fourth built-in template matching a sample "CoVet"-style meeting summary format:
Meeting Details (topic, date, time, attendees), Discussion Topics broken into a sub-heading per
topic with supporting bullet points (and a nested sub-bullet where a point has its own
supporting detail), and Action Items.

That format needed two things the report viewer's small hand-written Markdown renderer
(`lib/markdown.ts`) didn't support yet: a sub-heading level distinct from the main section
headings (`###`, rendered plainer than `##` so "one topic within Discussion Topics" reads
differently from "a whole section"), and one level of nested bullets (a `- ` line indented under
another becomes a sub-list of that bullet, instead of being flattened into the same list).
Upgraded the renderer to support both — verified it still renders the existing templates
(flat headings and bullets, no nesting) exactly as before, and that the new nesting/sub-heading
behavior works as expected, before rebuilding.

### Fixed: long/detailed reports silently cutting off mid-sentence

For a long or dense meeting (a multi-hour recording covering many separate topics), the
generated report could stop abruptly mid-bullet with no error message at all — it looked
"finished" but wasn't. The cause: `app/api/generate-report/route.ts` asks Claude for at most
8000 output tokens per call (`max_tokens: 8000`), a limit chosen so a single call couldn't run
long enough to hit Vercel's 300-second function timeout (see the fix above). That's roughly
6000 words — comfortably enough for most meetings, but not always enough for a very long or
topic-dense one, and once Claude hits that ceiling it simply stops where it is; that's not a
timeout or an error, so nothing was reported.

Fixed by detecting this case (the API response's `stop_reason` is `"max_tokens"`) and making one
automatic continuation call: it "prefills" Claude's own partial answer as the last message and
asks it to keep going, so the continuation picks up exactly where generation stopped — no
repeated or re-summarized content. This roughly doubles the effective ceiling to ~14000 tokens
(~10,500 words) for one report. It's capped at a single continuation round (not more) to stay
within the same 300-second function budget: at typical Sonnet throughput, two calls' worth of
generation is already a meaningful chunk of that budget, and a third call would risk trading this
problem for the earlier 504 timeout one. If a report is still cut off after the automatic
continuation, it now says so explicitly at the end of the report text (instead of just stopping),
and suggests regenerating, splitting the meeting into shorter recordings, or using a shorter/less
detailed template.

## Known limitations, worth knowing about

- **Storage is per-browser.** Recordings live in that browser's IndexedDB — they won't show up
  if you open the site on a different device or in a different browser. There's no account
  system or sync. Clearing your browser's site data deletes your recordings.
- **Browser support**: built and tested against Chrome-family browsers, which is where
  `MediaRecorder` (including pause/resume) is most reliably supported. Firefox should work fine
  too. Safari's `MediaRecorder` support (especially pause/resume, and on iOS) has historically
  been less consistent — test it before relying on it there.
- **Function time limits**: each transcription request handles one ~4-minute segment, and report
  writing is one Claude call — both comfortably fit inside Vercel's default serverless function
  timeout. If you ever raise the segment length, watch for timeouts on longer segments.
- **Login is a single shared password**, not real accounts — see the "Login" section above. It
  keeps casual visitors out; it isn't meant to withstand a determined attacker.
- **Markdown rendering** for the report view is a small hand-written renderer (headings, bullet
  lists, bold) rather than a full Markdown library — it covers exactly the format the report
  prompt asks Claude to produce, but won't handle arbitrary Markdown if you hand-edit a template
  to use fancier formatting.

## Project layout

```
app/
  page.tsx                    Top-level view switcher (list / record / detail / templates)
  layout.tsx, globals.css     App shell + Tailwind (dark, KoreVia-branded theme)
  login/page.tsx               Branded login screen + "About KoreVia" blurb
  api/transcribe/route.ts     Serverless: one audio segment -> OpenAI Whisper -> text
  api/generate-report/route.ts Serverless: transcript + template -> Claude -> title + Markdown report
  api/login/route.ts           Checks username/password, sets the session cookie
  api/logout/route.ts          Clears the session cookie
middleware.ts                 Auth gate — redirects to /login without a valid session cookie
components/
  BrandHeader.tsx              Shared logo + title header used by every screen
  Recorder.tsx                 Recording screen (start/pause/resume/stop)
  RecordingsList.tsx           Home screen
  RecordingDetail.tsx          Playback, generate report, transcript/report tabs, share/export
  TemplatesManager.tsx         Add/edit/duplicate/delete templates
  icons.tsx                    Small inline SVG icons (no icon library dependency)
lib/
  audio.ts                    SegmentedRecorder — the chunked MediaRecorder wrapper
  db.ts                       IndexedDB storage for recordings, segments, templates
  auth.ts                     Shared login-credential + session-token helpers
  types.ts, format.ts, markdown.ts
public/
  korevia-logo.png             KoreVia Solutions logo, used on the login screen and app header
```

## Extending it

- **Different transcription provider**: swap the fetch call in `app/api/transcribe/route.ts`.
- **Longer segments / different chunk size**: change `SegmentedRecorder.SEGMENT_MS` in
  `lib/audio.ts` (keep it well under Vercel's request body limit for your plan).
- **More templates by default**: add entries to `builtInTemplates()` in `lib/db.ts`.
- **Cloud sync / multi-device**: would mean swapping the IndexedDB layer for a real backend
  (a database plus some form of auth) — a bigger change than anything else here.
