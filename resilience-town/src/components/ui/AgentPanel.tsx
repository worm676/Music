"use client";

import { useState } from "react";
import { agentById, buildingById } from "@/config/agents";
import { STATUS_COLOR, STATUS_LABEL, type AgentStatus } from "@/lib/status";
import type { Task } from "@/lib/types";
import { Btn, TaskCard } from "./TaskCard";

type Act = (id: string, body: Record<string, unknown>) => Promise<unknown>;

export function AgentPanel({
  agentId,
  status,
  tasks,
  onClose,
  onAssign,
  act,
  run,
}: {
  agentId: string;
  status: AgentStatus;
  tasks: Task[];
  onClose: () => void;
  onAssign: (t: { title: string; instructions: string; priority: string; due_date: string | null }) => Promise<void>;
  act: Act;
  run: (id: string) => void;
}) {
  const agent = agentById(agentId)!;
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mine = tasks.filter((t) => t.agent_id === agentId);

  return (
    <aside className="pointer-events-auto flex h-full w-full max-w-md flex-col border-l border-slate-700/60 bg-slate-900/92 backdrop-blur">
      <div className="flex items-start gap-3 border-b border-slate-700/60 p-4">
        <div className="grid h-11 w-11 place-items-center rounded-full text-lg font-bold text-slate-900" style={{ background: agent.color }}>
          {agent.name[0]}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white">{agent.name}</h2>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: STATUS_COLOR[status] }}>
              {STATUS_LABEL[status]}
            </span>
          </div>
          <div className="text-xs text-slate-400">
            {agent.role} · {buildingById(agent.building)?.name}
          </div>
          <p className="mt-1 text-xs text-slate-300">{agent.summary}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {agent.tools.map((t) => (
              <span key={t} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                {t}
              </span>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-white" aria-label="Close">
          ×
        </button>
      </div>

      <form
        className="space-y-2 border-b border-slate-700/60 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await onAssign({ title: title.trim(), instructions: instructions.trim(), priority, due_date: due || null });
            setTitle("");
            setInstructions("");
            setDue("");
            setPriority("normal");
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">New task for {agent.name}</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="w-full rounded bg-slate-800 px-3 py-2 text-sm text-white outline-none ring-1 ring-slate-600 focus:ring-blue-500"
        />
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Instructions: context, goal, what done looks like"
          className="h-24 w-full rounded bg-slate-800 px-3 py-2 text-sm text-white outline-none ring-1 ring-slate-600 focus:ring-blue-500"
        />
        <div className="flex gap-2">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="flex-1 rounded bg-slate-800 px-2 py-2 text-sm text-white ring-1 ring-slate-600"
          >
            {["low", "normal", "high", "urgent"].map((p) => (
              <option key={p} value={p}>
                Priority: {p}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="flex-1 rounded bg-slate-800 px-2 py-2 text-sm text-white ring-1 ring-slate-600 [color-scheme:dark]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Btn type="submit" tone="blue" disabled={busy || !title.trim()}>
            {busy ? "Assigning…" : "Assign"}
          </Btn>
          {err && <span className="text-xs text-red-400">{err}</span>}
        </div>
      </form>

      <div className="flex-1 space-y-2 overflow-auto p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tasks ({mine.length})</div>
        {mine.length === 0 && <p className="text-xs text-slate-500">No tasks yet.</p>}
        {mine.map((t, i) => (
          <TaskCard key={t.id} task={t} act={act} run={run} showAgent={false} defaultOpen={i === 0} />
        ))}
      </div>
    </aside>
  );
}
