"use client";

import { useEffect, useState } from "react";
import { listTemplates, saveTemplate, deleteTemplate, builtInTemplates } from "@/lib/db";
import { Template } from "@/lib/types";
import { PlusIcon } from "./icons";
import BrandHeader from "./BrandHeader";

type EditState = { mode: "new" } | { mode: "edit"; template: Template } | null;

export default function TemplatesManager({ onBack }: { onBack: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editState, setEditState] = useState<EditState>(null);

  async function refresh() {
    const list = await listTemplates();
    setTemplates(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  if (editState) {
    return (
      <TemplateEditor
        initial={editState.mode === "edit" ? editState.template : null}
        onCancel={() => setEditState(null)}
        onSaved={async () => {
          setEditState(null);
          await refresh();
        }}
        onDeleted={async () => {
          setEditState(null);
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-grid">
      <BrandHeader title="Templates" onBack={onBack} />

      <main className="px-4 pt-6 max-w-2xl mx-auto">
        {loading ? (
          <p className="text-sm text-slate-500 text-center mt-12">Loading…</p>
        ) : (
          <ul className="space-y-3">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setEditState({ mode: "edit", template: t })}
                  className="w-full text-left glass-card rounded-xl p-4 hover:border-accent/40 hover:shadow-glow transition"
                >
                  <div className="font-semibold text-slate-100">{t.name}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {t.isBuiltIn ? "Built-in" : "Custom"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <button
        onClick={() => setEditState({ mode: "new" })}
        aria-label="Add template"
        className="fixed bottom-6 right-6 bg-brand-gradient hover:brightness-110 text-white rounded-full w-16 h-16 shadow-glow-blue flex items-center justify-center text-2xl transition"
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function TemplateEditor({
  initial,
  onCancel,
  onSaved,
  onDeleted,
}: {
  initial: Template | null;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const isBuiltIn = initial?.isBuiltIn === true;

  // All templates -- built-in or custom -- are editable and saved in place. A built-in
  // template's id is well-known (see lib/db.ts), so once it's saved here it's just a
  // regular row in storage from then on and won't be reset by the app's built-in seeding
  // logic (that only ever fills in a built-in template that's missing entirely).
  async function handleSave() {
    if (!name.trim() || !instructions.trim()) return;
    await saveTemplate({
      id: initial ? initial.id : crypto.randomUUID(),
      name: name.trim(),
      instructions: instructions.trim(),
      isBuiltIn,
    });
    onSaved();
  }

  async function handleDelete() {
    if (!initial || isBuiltIn) return;
    if (!confirm("Delete this template?")) return;
    await deleteTemplate(initial.id);
    onDeleted();
  }

  async function handleDuplicate() {
    if (!initial) return;
    await saveTemplate({
      id: crypto.randomUUID(),
      name: `${initial.name} (Copy)`,
      instructions: initial.instructions,
      isBuiltIn: false,
    });
    onSaved();
  }

  async function handleResetToDefault() {
    if (!initial || !isBuiltIn) return;
    const original = builtInTemplates().find((t) => t.id === initial.id);
    if (!original) return;
    if (!confirm(`Discard your edits and restore "${original.name}" to its original wording?`)) return;
    await saveTemplate(original);
    onSaved();
  }

  return (
    <div className="min-h-screen flex flex-col bg-grid">
      <BrandHeader title={initial ? initial.name : "New template"} onBack={onCancel} />

      <main className="flex-1 px-4 pt-6 max-w-2xl mx-auto w-full flex flex-col gap-4">
        {isBuiltIn && (
          <p className="text-xs text-slate-500 -mt-1">
            Built-in template — fully editable. Your changes save in place; use "Reset to
            default" below if you want the original wording back.
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-300">Template name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-ink-800/80 border border-white/10 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent/60 transition"
          />
        </label>

        <label className="flex flex-col gap-1.5 flex-1">
          <span className="text-sm font-medium text-slate-300">
            Describe the sections and format you want in the report
          </span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={14}
            className="bg-ink-800/80 border border-white/10 rounded-lg px-3 py-2 font-mono text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent/60 transition"
          />
        </label>

        {initial && (
          <button
            onClick={handleDuplicate}
            className="border border-white/15 text-slate-200 rounded-lg py-2.5 font-medium hover:bg-white/5 transition"
          >
            Duplicate as new template
          </button>
        )}
      </main>

      <div className="p-4 flex flex-col gap-3 max-w-2xl mx-auto w-full">
        <div className="flex gap-3">
          {initial && !isBuiltIn && (
            <button
              onClick={handleDelete}
              className="flex-1 border border-red-500/40 text-red-400 rounded-lg py-2.5 font-medium hover:bg-red-500/10 transition"
            >
              Delete
            </button>
          )}
          <button
            onClick={handleSave}
            className="flex-1 bg-brand-gradient text-white rounded-lg py-2.5 font-medium hover:brightness-110 transition shadow-glow-blue"
          >
            Save
          </button>
        </div>
        {isBuiltIn && (
          <button
            onClick={handleResetToDefault}
            className="text-xs text-slate-500 hover:text-slate-300 py-1 transition"
          >
            Reset to default wording
          </button>
        )}
      </div>
    </div>
  );
}
