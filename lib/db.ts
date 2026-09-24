"use client";

import { RecordingMeta, RecordingSegment, Template } from "./types";

const DB_NAME = "meetingscribe";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("recordings")) {
        db.createObjectStore("recordings", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("segments")) {
        const store = db.createObjectStore("segments", { keyPath: "id" });
        store.createIndex("by_recording", "recordingId", { unique: false });
      }
      if (!db.objectStoreNames.contains("templates")) {
        db.createObjectStore("templates", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- Recordings ----

export async function listRecordings(): Promise<RecordingMeta[]> {
  const db = await openDb();
  const tx = db.transaction("recordings", "readonly");
  const all = await promisifyRequest(tx.objectStore("recordings").getAll());
  return (all as RecordingMeta[]).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRecording(id: string): Promise<RecordingMeta | undefined> {
  const db = await openDb();
  const tx = db.transaction("recordings", "readonly");
  return promisifyRequest(tx.objectStore("recordings").get(id));
}

export async function saveRecording(meta: RecordingMeta): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("recordings", "readwrite");
  tx.objectStore("recordings").put(meta);
  await promisifyTx(tx);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await openDb();
  const segTx = db.transaction("segments", "readwrite");
  const index = segTx.objectStore("segments").index("by_recording");
  const keys = await promisifyRequest(index.getAllKeys(IDBKeyRange.only(id)));
  for (const key of keys as IDBValidKey[]) {
    segTx.objectStore("segments").delete(key);
  }
  await promisifyTx(segTx);

  const recTx = db.transaction("recordings", "readwrite");
  recTx.objectStore("recordings").delete(id);
  await promisifyTx(recTx);
}

// ---- Segments ----

export async function addSegment(segment: RecordingSegment): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("segments", "readwrite");
  tx.objectStore("segments").put(segment);
  await promisifyTx(tx);
}

export async function getSegments(recordingId: string): Promise<RecordingSegment[]> {
  const db = await openDb();
  const tx = db.transaction("segments", "readonly");
  const index = tx.objectStore("segments").index("by_recording");
  const all = await promisifyRequest(index.getAll(IDBKeyRange.only(recordingId)));
  return (all as RecordingSegment[]).sort((a, b) => a.index - b.index);
}

// ---- Templates ----

const SOAP_TEMPLATE_ID = "builtin-soap-meeting";
const BUSINESS_TEMPLATE_ID = "builtin-business-meeting";
const PROJECT_WORKFLOW_TEMPLATE_ID = "builtin-project-workflow-whitepaper";
const COVET_STYLE_TEMPLATE_ID = "builtin-covet-style-summary";

export function builtInTemplates(): Template[] {
  return [
    {
      id: SOAP_TEMPLATE_ID,
      isBuiltIn: true,
      name: "SOAP Meeting Note",
      instructions: `Write a structured meeting report from the transcript below, in Markdown,
using exactly these four sections (the classic SOAP format, adapted for a meeting instead of a
clinical visit):

## Subjective
What people said — context, concerns, opinions, and perspectives raised during the discussion,
in their own words where it matters. Note who said what if speakers are identifiable.

## Objective
The facts on the table — data, figures, updates, and anything stated as settled fact or a
decision during the meeting.

## Assessment
Your analysis of the discussion — the key takeaways, risks, blockers, or an evaluation of where
things currently stand based on what was said.

## Plan
The action items and next steps, each as its own bullet in the form
"Action — Owner (if stated) — Due date (if stated)". Omit owner or due date rather than guessing
if they weren't mentioned.

Only use information actually present in the transcript. Do not invent names, numbers, dates, or
commitments. If a section has nothing to report, say so plainly instead of leaving it blank.`,
    },
    {
      id: BUSINESS_TEMPLATE_ID,
      isBuiltIn: true,
      name: "Business Meeting",
      instructions: `Write a clear, well-organized business meeting report from the transcript
below. Format the report in Markdown using exactly these sections, in this order:

## Summary
A 2-4 sentence overview of what the conversation was about and its outcome.

## Attendees / Speakers
A bullet list of the people who appear to have spoken, identified by name if stated, otherwise
as "Speaker 1", "Speaker 2", etc.

## Topics Discussed
A bullet list of the main topics, each with one or two sentences of context.

## Decisions Made
A bullet list of concrete decisions that were agreed on. If none were made, write
"No decisions were recorded."

## Action Items
A bullet list in the form "Action — Owner (if stated) — Due date (if stated)".

## Next Steps
A short bullet list of what happens next.

Only use information that is actually present in the transcript. Do not invent names, dates,
numbers, or commitments.`,
    },
    {
      id: PROJECT_WORKFLOW_TEMPLATE_ID,
      isBuiltIn: true,
      name: "Project Plan & A–Z Workflow White Paper",
      instructions: `Write a long, thorough white paper from the transcript below, documenting a
planning meeting about a CRM system for behaviour support / allied health service delivery. The
goal is a self-contained reference document detailed and precise enough that it can be pasted
into a fresh conversation with an AI assistant to draft a full product specification from it —
so completeness and precision matter far more than brevity here. Favor including a specific
detail over summarizing it away. Use Markdown, with exactly these sections, in this order:

## Executive Summary
3-5 sentences: what this meeting covered, what was decided, and the overall direction of the
CRM project.

## Project Context & Background
Why this CRM is needed, what problem it solves, and anything said about the current process,
tools, or pain points it's replacing.

## Stakeholders & Roles
A bullet list of every person, role, or organisation type mentioned as involved or affected
(e.g. clinicians, behaviour support practitioners, allied health providers, support workers,
participants/clients, families or guardians, referrers, funding bodies, admin or management
staff) — only what's actually named or described.

## Objectives & Success Criteria
What the CRM is meant to achieve, and how success will be judged, if stated.

## Agreed Decisions
A clearly marked bullet list of everything that was explicitly confirmed or agreed in the
meeting. This is the most important section for accuracy — only include something here if it
was actually settled, not merely floated.

## Proposed / Under Discussion
Ideas, features, or approaches that came up but were NOT confirmed as decided — keep this
strictly separate from "Agreed Decisions" above so the two are never confused.

## Open Questions & Unresolved Items
Anything left undecided that still needs an answer before the project can move forward.

## End-to-End (A–Z) Workflow
The heart of this document: a numbered, chronological walkthrough of the full workflow through
the CRM as discussed — e.g. referral/intake, assessment, support or care plan development,
service delivery and session/case notes, progress and goal tracking, incident or risk reporting,
billing/claims, compliance and reporting, case closure — but only include stages that were
actually discussed, in the order and detail the meeting covered them. For EACH step, use this
format:

### Step N: [Step name]
- **Trigger:** what starts this step
- **Actor(s):** who is involved
- **Actions:** what happens / what the CRM does or shows
- **Data captured or updated:** what information is recorded
- **Output / handoff:** what happens next, and who or what it goes to

If the meeting didn't cover the workflow in this much granular detail for a given step, note
that plainly (e.g. "Not covered in detail in this meeting") rather than inventing plausible
steps to fill the gap.

## Functional Requirements
Every specific feature, module, or capability requested, grouped under sensible headings (for
example Client & Case Management, Scheduling, Documentation & Case Notes, Goal & Outcome
Tracking, Incident & Risk Management, Billing / Claims, Compliance & Consent, Reporting &
Analytics, Communications, Integrations) — only group headings that actually apply to what was
discussed.

## Non-Functional Requirements & Constraints
Anything said about privacy/compliance (e.g. health data handling, funding-body compliance such
as NDIS if mentioned), security, data retention, integrations with existing systems, performance,
or accessibility.

## Assumptions
Anything the discussion seemed to take for granted rather than explicitly state.

## Risks & Dependencies
Anything flagged as a risk, blocker, or dependency on another team, system, or decision.

## Out of Scope
Anything explicitly ruled out or deferred, if stated.

## Glossary
A short list defining any domain-specific terms, acronyms, or system names used in the meeting
(e.g. funding scheme names, clinical or sector-specific terminology), in plain language, based
only on how they were used in context.

## Recommended Next Steps
A bullet list of what should happen next.

## Open Items for the Product Spec
A bullet list, separate from "Open Questions" above, specifically framed as: what a product
spec author still needs to pin down before writing a full specification from this white paper.

Throughout, write in full sentences and clearly labelled detail rather than terse fragments.
Only use information that is actually present in the transcript — never invent names, features,
workflow steps, numbers, or decisions. Where a section has nothing to report, say so explicitly
(e.g. "Not discussed in this meeting") instead of leaving it blank or guessing.`,
    },
    {
      id: COVET_STYLE_TEMPLATE_ID,
      isBuiltIn: true,
      name: "CoVet-Style Meeting Summary",
      instructions: `Write a meeting summary from the transcript below, in Markdown, using
exactly this structure and in this order:

## Meeting Details
Start with one bold line naming what the meeting was about, in the form
"**Discussion on [topic]**".

Then a short bullet list with only the lines that apply (omit either one entirely if the
transcript doesn't give you that detail -- never guess a date or time):
- **Date:** [the date, if stated in the transcript]
- **Time:** [the time, if stated]

Then, on its own line, write **Attending:** followed by a bullet list of who was there:
- [Name, with title or role if it was stated]
- [Name, with title or role if it was stated]

If someone expected was absent, or left early, or joined late, add one short plain sentence
noting who and why immediately after the attendee list, only if that was actually mentioned
(for example: "Mike was unable to attend as his flight was cancelled.").

## Discussion Topics
Break the discussion up into topics in the order they came up, and for EACH topic write a
level-3 heading naming it, followed by a bullet list of what was said, asked, or decided about
it. Keep bullets specific and close to what was actually said rather than compressed into vague
generalities -- capture names, numbers, product/company names, and direct claims people made.
Use a nested bullet (indent it two spaces under its parent bullet) when a point is really a
supporting detail or sub-item of the bullet above it, rather than its own separate point -- for
example a short list of specific features belonging to one broader point.

### [Topic name]
- [what was said or decided]
- [what was said or decided]
  - [a supporting detail or sub-item of the point directly above, if there is one]

### [Next topic name]
- [what was said or decided]

## Action Items
A bullet list of concrete action items in the form "Action — Owner (if stated) — Due date (if
stated)". If no action items came up, write "No action items were recorded." instead of leaving
the section empty.

Only use information that is actually present in the transcript. Do not invent names, dates,
company names, or commitments. If the transcript doesn't give you something this format expects
(for example, no one stated the date or time), just omit that specific line rather than
guessing or writing a placeholder.`,
    },
  ];
}

export async function listTemplates(): Promise<Template[]> {
  const db = await openDb();
  const tx = db.transaction("templates", "readonly");
  const stored = (await promisifyRequest(tx.objectStore("templates").getAll())) as Template[];

  const builtIns = builtInTemplates();
  const storedIds = new Set(stored.map((t) => t.id));
  const missingBuiltIns = builtIns.filter((t) => !storedIds.has(t.id));

  if (missingBuiltIns.length > 0) {
    const writeTx = db.transaction("templates", "readwrite");
    for (const t of missingBuiltIns) writeTx.objectStore("templates").put(t);
    await promisifyTx(writeTx);
  }

  return [...missingBuiltIns, ...stored].sort((a, b) => {
    if (a.isBuiltIn !== b.isBuiltIn) return a.isBuiltIn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function saveTemplate(template: Template): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("templates", "readwrite");
  tx.objectStore("templates").put(template);
  await promisifyTx(tx);
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("templates", "readwrite");
  tx.objectStore("templates").delete(id);
  await promisifyTx(tx);
}

function promisifyTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
