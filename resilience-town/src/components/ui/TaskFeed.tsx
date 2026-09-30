"use client";

import { useMemo, useState } from "react";
import { AGENTS } from "@/config/agents";
import type { Task, TaskStatus } from "@/lib/types";
import { Btn, TaskCard } from "./TaskCard";

type Act = (id: string, body: Record<string, unknown>) => Promise<unknown>;

export function TaskFeed({ tasks, act, run, onClose }: { tasks: Task[]; act: Act; run: (id: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [agent, setAgent] = useState<string>("all");

  // Top-level tasks, with Chief's subtasks nested under their parent.
  const { roots, children } = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    const children = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const t of tasks) {
      if (t.parent_task_id && ids.has(t.parent_task_id)) {
        children.set(t.parent_task_id, [...(children.get(t.parent_task_id) ?? []), t]);
      } else roots.push(t);
    }
    return { roots, children };
  }, [tasks]);

  const match = (t: Task) => (filter === "all" || t.status === filter) && (agent === "all" || t.agent_id === agent);
  const visible = roots.filter((t) => match(t) || (children.get(t.id) ?? []).some(match));
  const queued = tasks.filter((t) => t.status === "queued");

  return (
    <aside className="pointer-events-auto flex h-full w-full max-w-md flex-col border-r border-slate-700/60 bg-slate-900/92 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-slate-700/60 p-3">
        <h2 className="flex-1 text-sm font-bold text-white">Task feed</h2>
        {queued.length > 0 && (
          <Btn tone="blue" onClick={() => queued.forEach((t) => run(t.id))}>
            Run {queued.length} queued
          </Btn>
        )}
        <button onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-white" aria-label="Close">
          ×
        </button>
      </div>
      <div className="flex gap-2 border-b border-slate-700/60 p-3">
        <select value={filter} onChange={(e) => setFilter(e.target.value as TaskStatus | "all")} className="flex-1 rounded bg-slate-800 px-2 py-1 text-xs text-white ring-1 ring-slate-600">
          {["all", "queued", "working", "needs_input", "done", "error"].map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} className="flex-1 rounded bg-slate-800 px-2 py-1 text-xs text-white ring-1 ring-slate-600">
          <option value="all">All agents</option>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {visible.length === 0 && <p className="text-xs text-slate-500">No tasks match.</p>}
        {visible.map((t) => {
          const kids = children.get(t.id) ?? [];
          return (
            <TaskCard key={t.id} task={t} act={act} run={run}>
              {kids.length > 0 && (
                <div className="space-y-2 border-l-2 border-yellow-500/50 pl-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Subtasks ({kids.length})</div>
                  {kids.map((k) => (
                    <TaskCard key={k.id} task={k} act={act} run={run} />
                  ))}
                </div>
              )}
            </TaskCard>
          );
        })}
      </div>
    </aside>
  );
}
