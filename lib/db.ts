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
