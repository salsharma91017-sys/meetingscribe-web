/**
 * Prompt construction and response parsing for report generation, kept apart from the API route
 * so the guard-rail wording and the parser can be tested without a server.
 */

const BASE_PROMPT =
  "You are an expert note-taker who writes clear, accurate reports strictly from the " +
  "transcript you are given. You never invent names, numbers, dates, or commitments that " +
  "are not present in the transcript. ";

const FORMAT_PLAIN =
  "Respond in exactly this format and nothing else: first a single line starting with " +
  "'TITLE: ' followed by a short, specific meeting title (5-8 words, no quotes, based on " +
  "what was actually discussed — e.g. 'TITLE: Q3 Budget Review With Finance Team'), then a " +
  "line containing only '---', then the full report in Markdown.";

const FORMAT_WITH_OMITTED =
  "Respond in exactly this format and nothing else: first a single line starting with " +
  "'TITLE: ' followed by a short, specific meeting title (5-8 words, no quotes, based on " +
  "what was actually discussed — e.g. 'TITLE: Q3 Budget Review With Finance Team'), then a " +
  "line containing only '---', then the full report in Markdown, then a line containing only " +
  "'===OMITTED===' followed by the list described under SCOPE GUARD RAILS.";

/** The off-topic guard rails. They live here, server-side, so they apply to every template --
 *  built-in or custom -- and can't be dropped by editing a template's wording. */
const SCOPE_GUARD_RAILS =
  " SCOPE GUARD RAILS — these apply on top of the report instructions and win if they " +
  "conflict. The meeting's scope is the subject the participants are actually there to work " +
  "through: use the 'Meeting scope' text if the user provides one, otherwise infer it from the " +
  "report instructions and from what the conversation is mostly about. Only content that " +
  "serves that scope belongs in the report: discussion points, decisions, agreements, " +
  "figures, dates, risks, open questions and action items. Leave out: small talk and banter, " +
  "jokes, personal or social chat, unrelated side conversations, interruptions (a phone call " +
  "taken mid-meeting, someone entering, someone speaking to a third party) unless what was " +
  "said directly bears on a decision or policy the meeting is dealing with, and tangents " +
  "unrelated to the scope. Never turn an off-topic remark into a decision, action item or " +
  "quote. Write in neutral, professional wording: do not reproduce profanity, insults or " +
  "personal remarks about individuals, and if a point of substance was made in strong " +
  "language, record the substance factually. If you are unsure whether something is in " +
  "scope, keep it when it affects a decision, commitment, number, date or risk relating to " +
  "the meeting's purpose, and leave it out when it is merely social or incidental. " +
  "After the report, the '===OMITTED===' line is followed by a short bulleted list (at most " +
  "15 bullets, each under 12 words) describing in general terms what you left out as " +
  "off-topic or incidental, without repeating its content (for example '- Small talk about " +
  "weekend plans' or '- Phone call with a customer about a quote'). If nothing was left " +
  "out, write '- None'.";

/** Action-item completeness check. Reports used to list each topic's discussion well but then
 *  build the Action Items list from only some of it, so commitments that were written up under a
 *  topic (e.g. "Sel will update the specs, Noah signs off, then...") never reached the list.
 *  Applied server-side to every template, built-in or custom, for the same reason as the scope
 *  guard rails: built-in templates are stored in the browser once, so editing their wording
 *  wouldn't reach existing installs. */
const ACTION_COMPLETENESS =
  " ACTION ITEM COMPLETENESS — this applies to any action items, next steps or plan section, and " +
  "wins if it conflicts with the report instructions. Before you finish, go back through every " +
  "topic you wrote up and check that each commitment is also listed there: anything someone said " +
  "they or another person will do, agreed processes and hand-offs (write a sequence like 'A updates " +
  "the specs, B signs off, then A sends them to C' as one action naming the whole sequence and who " +
  "does each step), meetings or calls to be arranged or attended, things someone is to provide, " +
  "investigate or confirm, follow-ups that depend on something else finishing, decisions that " +
  "someone now has to implement or build, and open questions someone has to get answered. A step " +
  "that already appears in the discussion section is still an action item if someone has to do it. " +
  "Use one action per distinct commitment and list a commitment once even if it came up several " +
  "times. Add an owner or date only if the transcript states it; never guess one. If speakers gave " +
  "different owners, dates or outcomes for the same thing, say so in that action instead of quietly " +
  "choosing one. Do not add items that only describe the past or a general wish that nobody is " +
  "responsible for. If a report section is meant to list decisions, also make sure every decision " +
  "stated in the discussion appears there.";

export function buildSystemPrompt(filterOffTopic: boolean): string {
  return filterOffTopic
    ? BASE_PROMPT + FORMAT_WITH_OMITTED + ACTION_COMPLETENESS + SCOPE_GUARD_RAILS
    : BASE_PROMPT + FORMAT_PLAIN + ACTION_COMPLETENESS;
}

const MAX_SCOPE_CHARS = 600;

export function buildUserContent(
  templateInstructions: string,
  transcript: string,
  meetingScope?: string
): string {
  const scope = (meetingScope ?? "").trim().slice(0, MAX_SCOPE_CHARS);
  const scopeBlock = scope ? `\n\nMeeting scope (provided by the user): ${scope}` : "";
  return `${templateInstructions.trim()}${scopeBlock}\n\n---TRANSCRIPT START---\n${transcript.trim()}\n---TRANSCRIPT END---`;
}

export interface ParsedReport {
  title: string | null;
  report: string;
  /** What was left out as off-topic, as short descriptions. Empty if none, or if the filter was off. */
  omitted: string[];
  /** True if the '===OMITTED===' marker was present, i.e. the report itself reached its end. */
  omittedMarkerFound: boolean;
}

const OMITTED_MARKER = /\r?\n[ \t]*={3,}[ \t]*OMITTED[ \t]*={3,}[ \t]*(?:\r?\n|$)/i;
const MAX_OMITTED_ITEMS = 20;

function parseOmittedList(raw: string): string[] {
  const items: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*•]\s+(.+?)\s*$/);
    if (!m) continue;
    const text = m[1].replace(/\*\*/g, "").trim();
    if (!text || /^none\.?$/i.test(text)) continue;
    items.push(text);
    if (items.length >= MAX_OMITTED_ITEMS) break;
  }
  return items;
}

/** Splits the model's "TITLE: ...\n---\n<report>\n===OMITTED===\n- ..." response into its parts.
 *  Falls back gracefully if the model didn't follow the format: no TITLE line means the whole
 *  response is the report, and no OMITTED marker means nothing is listed as omitted. */
export function parseReportResponse(raw: string): ParsedReport {
  let body = raw;
  let omitted: string[] = [];
  let omittedMarkerFound = false;

  const marker = OMITTED_MARKER.exec(raw);
  if (marker) {
    omittedMarkerFound = true;
    body = raw.slice(0, marker.index);
    omitted = parseOmittedList(raw.slice(marker.index + marker[0].length));
  }

  // A model sometimes puts a horizontal rule ('---') just before the OMITTED marker; it isn't
  // part of the report, so drop it.
  const stripTrailingRule = (s: string) => s.replace(/\s*\n-{3,}\s*$/, "").trim();

  const match = body.match(/^\s*TITLE:\s*(.+?)\s*\r?\n-{3,}\s*\r?\n([\s\S]*)$/);
  if (match) {
    const title = match[1].trim().replace(/^["']|["']$/g, "");
    const report = stripTrailingRule(match[2]);
    if (title && report) return { title, report, omitted, omittedMarkerFound };
  }
  return { title: null, report: stripTrailingRule(body), omitted, omittedMarkerFound };
}
