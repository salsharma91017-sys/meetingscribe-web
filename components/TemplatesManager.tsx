"use client";

import { useEffect, useState } from "react";
import { listTemplates, saveTemplate, deleteTemplate } from "@/lib/db";
import { Template } from "@/lib/types";
import { BackIcon, PlusIcon } from "./icons";

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
    <div className="min-h-screen pb-24">
      <header className="bg-brand text-white px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} aria-label="Back" className="text-xl">
          <BackIcon />
        </button>
        <h1 className="text-lg font-semibold">Templates</h1>
      </header>

      <main className="px-4 pt-4 max-w-2xl mx-auto">
        {loading ? (
          <p className="text-sm text-gray-500 text-center mt-12">Loading…</p>
        ) : (
          <ul className="space-y-3">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setEditState({ mode: "edit", template: t })}
                  className="w-full text-left bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition"
                >
                  <div className="font-semibold text-gray-900">{t.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{t.isBuiltIn ? "Built-in" : "Custom"}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <button
        onClick={() => setEditState({ mode: "new" })}
        aria-label="Add template"
        className="fixed bottom-6 right-6 bg-accent hover:bg-red-500 text-white rounded-full w-16 h-16 shadow-lg flex items-center justify-center text-2xl transition"
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

  async function handleSave() {
    if (!name.trim() || !instructions.trim()) return;
    await saveTemplate({
      id: initial && !isBuiltIn ? initial.id : crypto.randomUUID(),
      name: name.trim(),
      instructions: instructions.trim(),
      isBuiltIn: false,
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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand text-white px-4 py-4 flex items-center gap-3">
        <button onClick={onCancel} aria-label="Back" className="text-xl">
          <BackIcon />
        </button>
        <h1 className="text-lg font-semibold truncate">{initial ? initial.name : "New template"}</h1>
      </header>

      <main className="flex-1 px-4 pt-4 max-w-2xl mx-auto w-full flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Template name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isBuiltIn}
            className="border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100"
          />
        </label>

        <label className="flex flex-col gap-1 flex-1">
          <span className="text-sm font-medium text-gray-700">
            Describe the sections and format you want in the report
          </span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={isBuiltIn}
            rows={14}
            className="border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm disabled:bg-gray-100"
          />
        </label>

        {isBuiltIn && (
          <button
            onClick={handleDuplicate}
            className="bg-brand text-white rounded-lg py-2.5 font-medium hover:bg-brand-dark transition"
          >
            Duplicate as custom template
          </button>
        )}
      </main>

      {!isBuiltIn && (
        <div className="p-4 flex gap-3 max-w-2xl mx-auto w-full">
          {initial && (
            <button
              onClick={handleDelete}
              className="flex-1 border border-red-500 text-red-600 rounded-lg py-2.5 font-medium hover:bg-red-50 transition"
            >
              Delete
            </button>
          )}
          <button
            onClick={handleSave}
            className="flex-1 bg-brand text-white rounded-lg py-2.5 font-medium hover:bg-brand-dark transition"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
