"use client";

import { useState } from "react";
import { TASK_STATUS_COLOR } from "@/lib/status";
import type { Task, TaskStatus } from "@/lib/types";

const ORDER: TaskStatus[] = ["queued", "working", "needs_input", "done", "error"];

export function TopBar({
  tasks,
  onCommand,
  onToggleFeed,
  feedOpen,
  mode,
}: {
  tasks: Task[];
  onCommand: (goal: string) => Promise<void>;
  onToggleFeed: () => void;
  feedOpen: boolean;
  mode: string;
}) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const counts = Object.fromEntries(ORDER.map((s) => [s, tasks.filter((t) => t.status === s).length])) as Record<TaskStatus, number>;

  return (
    <header className="pointer-events-auto flex flex-wrap items-center gap-3 border-b border-slate-700/60 bg-slate-900/85 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-lg">🏙️</span>
        <div>
          <div className="text-sm font-bold leading-tight text-white">Resilience Town</div>
          <div className="text-[10px] leading-tight text-slate-400">{mode}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">
            <span className="h-2 w-2 rounded-full" style={{ background: TASK_STATUS_COLOR[s] }} />
            {s.replace("_", " ")} <b className="text-white">{counts[s]}</b>
          </span>
        ))}
      </div>

      <form
        className="flex min-w-[260px] flex-1 items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!goal.trim()) return;
          setBusy(true);
          setErr(null);
          try {
            await onCommand(goal.trim());
            setGoal("");
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Command: give Chief a goal in plain English…"
          className="flex-1 rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white outline-none ring-1 ring-slate-600 placeholder:text-slate-500 focus:ring-yellow-400"
        />
        <button disabled={busy || !goal.trim()} className="rounded-md bg-yellow-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-40">
          {busy ? "Sending…" : "Command"}
        </button>
        {err && <span className="text-xs text-red-400">{err}</span>}
      </form>

      <button onClick={onToggleFeed} className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600">
        {feedOpen ? "Hide feed" : `Task feed${counts.needs_input ? ` (${counts.needs_input} need you)` : ""}`}
      </button>
    </header>
  );
}
