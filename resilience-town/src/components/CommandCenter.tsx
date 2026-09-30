"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AGENTS } from "@/config/agents";
import { agentStatus, type AgentStatus } from "@/lib/status";
import { realtimeEnabled, useTasks } from "@/lib/useTasks";
import { AgentPanel } from "./ui/AgentPanel";
import { TaskFeed } from "./ui/TaskFeed";
import { TopBar } from "./ui/TopBar";

const Town = dynamic(() => import("./scene/Town"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-400">Building the town…</div>,
});

export function CommandCenter() {
  const { tasks, error, create, act, run } = useTasks();
  const [selected, setSelected] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [server, setServer] = useState<{ anthropic: boolean; supabase: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setServer)
      .catch(() => {});
  }, []);

  const statuses = useMemo(
    () => Object.fromEntries(AGENTS.map((a) => [a.id, agentStatus(tasks, a.id)])) as Record<string, AgentStatus>,
    [tasks],
  );

  const mode = !server
    ? "connecting…"
    : [server.anthropic ? "Claude live" : "Demo agents (no API key)", server.supabase && realtimeEnabled ? "Supabase realtime" : "in-memory tasks"].join(" · ");

  return (
    <div className="relative h-screen w-screen">
      <div className="absolute inset-0">
        <Town statuses={statuses} selectedId={selected} onSelect={setSelected} />
      </div>

      <div className="pointer-events-none absolute inset-0 z-50 flex flex-col">
        <TopBar
          tasks={tasks}
          mode={mode}
          feedOpen={feedOpen}
          onToggleFeed={() => setFeedOpen(!feedOpen)}
          onCommand={async (goal) => {
            await create({ agent_id: "chief", title: goal.length > 80 ? `${goal.slice(0, 77)}…` : goal, instructions: goal, priority: "high" });
            setSelected("chief");
          }}
        />
        {error && <div className="pointer-events-auto bg-red-900/90 px-4 py-1 text-xs text-red-100">{error}</div>}
        <div className="flex min-h-0 flex-1 justify-between">
          <div className="min-h-0 w-full max-w-md">
            {feedOpen && <TaskFeed tasks={tasks} act={act} run={run} onClose={() => setFeedOpen(false)} />}
          </div>
          <div className="min-h-0 w-full max-w-md">
            {selected && (
              <AgentPanel
                key={selected}
                agentId={selected}
                status={statuses[selected]}
                tasks={tasks}
                act={act}
                run={run}
                onClose={() => setSelected(null)}
                onAssign={async (t) => {
                  await create({ agent_id: selected, ...t });
                }}
              />
            )}
          </div>
        </div>
      </div>

      {!selected && !feedOpen && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/75 px-4 py-1.5 text-xs text-slate-200">
          Click an agent or building to assign work · drag to orbit · scroll to zoom
        </div>
      )}
    </div>
  );
}
