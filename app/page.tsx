"use client";

import { useEffect, useState } from "react";
import { listRecordings } from "@/lib/db";
import { RecordingMeta } from "@/lib/types";
import RecordingsList from "@/components/RecordingsList";
import Recorder from "@/components/Recorder";
import RecordingDetail from "@/components/RecordingDetail";
import TemplatesManager from "@/components/TemplatesManager";

type View =
  | { name: "list" }
  | { name: "record" }
  | { name: "detail"; id: string }
  | { name: "templates" };

export default function Home() {
  const [view, setView] = useState<View>({ name: "list" });
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const list = await listRecordings();
    setRecordings(list);
  }

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (view.name === "list") refresh();
  }, [view]);

  if (!ready) {
    return <div className="p-6 text-center text-gray-500">Loading…</div>;
  }

  switch (view.name) {
    case "record":
      return (
        <Recorder
          onDone={(id) => setView({ name: "detail", id })}
          onCancel={() => setView({ name: "list" })}
        />
      );
    case "detail":
      return (
        <RecordingDetail
          recordingId={view.id}
          onBack={() => setView({ name: "list" })}
          onDeleted={() => setView({ name: "list" })}
        />
      );
    case "templates":
      return <TemplatesManager onBack={() => setView({ name: "list" })} />;
    default:
      return (
        <RecordingsList
          recordings={recordings}
          onSelect={(id) => setView({ name: "detail", id })}
          onNewRecording={() => setView({ name: "record" })}
          onOpenTemplates={() => setView({ name: "templates" })}
        />
      );
  }
}
