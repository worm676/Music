"use client";

import { useState } from "react";
import { agentById } from "@/config/agents";
import { TASK_STATUS_COLOR } from "@/lib/status";
import type { PendingCall, Step, Task } from "@/lib/types";
import { Markdown } from "./Markdown";

type Act = (id: string, body: Record<string, unknown>) => Promise<unknown>;

const STEP_ICON: Record<Step["kind"], string> = {
  info: "•",
  thinking: "💭",
  text: "✎",
  search: "🔎",
  tool: "🛠",
  tool_result: "↩",
  approval: "🔒",
  question: "❓",
  user: "👤",
  error: "⚠",
};

export function StatusPill({ status }: { status: Task["status"] }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
      style={{ background: TASK_STATUS_COLOR[status] }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export function TaskCard({
  task,
  act,
  run,
  defaultOpen = false,
  showAgent = true,
  children: subtasks,
}: {
  task: Task;
  act: Act;
  run: (id: string) => void;
  defaultOpen?: boolean;
  showAgent?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || task.status === "needs_input");
  const [picked, setTab] = useState<"result" | "log" | null>(null);
  const tab = picked ?? (task.result ? "result" : "log");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [revise, setRevise] = useState<string | null>(null);
  const agent = agentById(task.agent_id);

  const go = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await act(task.id, body);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-800/70">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        {showAgent && agent && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: agent.color }} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-100">{task.title}</div>
          <div className="text-[11px] text-slate-400">
            {showAgent && agent ? `${agent.name} · ` : ""}
            {task.priority} · {new Date(task.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
            {task.due_date ? ` · due ${task.due_date}` : ""}
            {task.approved_at ? " · ✓ approved" : ""}
          </div>
        </div>
        <StatusPill status={task.status} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-700/60 px-3 py-3 text-sm">
          {task.instructions && <p className="whitespace-pre-wrap text-xs text-slate-400">{task.instructions}</p>}

          {task.pending_action?.pending.map((p) => (
            <PendingBox key={p.tool_use_id} call={p} busy={busy} onAct={go} />
          ))}

          <div className="flex gap-1 text-xs">
            {(["result", "log"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-2 py-1 ${tab === t ? "bg-slate-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {t === "result" ? "Result" : `Step log (${task.steps.length})`}
              </button>
            ))}
          </div>

          {tab === "result" ? (
            task.result ? (
              <div className="max-h-[50vh] overflow-auto rounded bg-slate-900/60 p-3">
                <Markdown>{task.result}</Markdown>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No result yet.</p>
            )
          ) : (
            <ol className="max-h-[40vh] space-y-1.5 overflow-auto rounded bg-slate-900/60 p-2">
              {task.steps.length === 0 && <li className="text-xs text-slate-500">Nothing yet.</li>}
              {task.steps.map((s, i) => (
                <li key={i} className={`flex gap-2 text-xs ${s.kind === "error" ? "text-red-300" : s.kind === "thinking" ? "italic text-slate-400" : "text-slate-200"}`}>
                  <span className="w-4 shrink-0 text-center">{STEP_ICON[s.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap break-words">{s.text}</div>
                    {s.data !== undefined && s.kind !== "tool" && <DataPreview data={s.data} />}
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-500">{new Date(s.at).toLocaleTimeString([], { timeStyle: "short" })}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-wrap gap-2">
            {task.status === "queued" && (
              <Btn onClick={() => run(task.id)} tone="blue">
                Run now
              </Btn>
            )}
            {task.status === "done" && !task.approved_at && (
              <Btn disabled={busy} onClick={() => go({ action: "approve" })} tone="green">
                Approve
              </Btn>
            )}
            {(task.status === "done" || task.status === "error") && (
              <Btn disabled={busy} onClick={() => setRevise(revise === null ? "" : null)}>
                Revise
              </Btn>
            )}
            {(task.status === "done" || task.status === "error" || task.status === "needs_input") && (
              <Btn disabled={busy} onClick={() => go({ action: "retry" })}>
                Retry
              </Btn>
            )}
          </div>

          {revise !== null && (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await go({ action: "revise", text: revise })) setRevise(null);
              }}
            >
              <textarea
                autoFocus
                value={revise}
                onChange={(e) => setRevise(e.target.value)}
                placeholder="What should change?"
                className="h-20 w-full rounded bg-slate-900 p-2 text-xs text-slate-100 outline-none ring-1 ring-slate-600 focus:ring-blue-500"
              />
              <Btn type="submit" disabled={busy || !revise.trim()} tone="blue">
                Send revision
              </Btn>
            </form>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}
          {subtasks}
        </div>
      )}
    </div>
  );
}

function PendingBox({ call, busy, onAct }: { call: PendingCall; busy: boolean; onAct: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [text, setText] = useState("");
  if (call.kind === "question") {
    return (
      <form
        className="space-y-2 rounded-md border border-amber-500/60 bg-amber-500/10 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onAct({ action: "answer", tool_use_id: call.tool_use_id, text })) setText("");
        }}
      >
        <div className="text-xs font-semibold text-amber-300">Agent asks:</div>
        <p className="text-sm text-amber-50">{call.question}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-16 w-full rounded bg-slate-900 p-2 text-xs text-slate-100 outline-none ring-1 ring-amber-600/60"
          placeholder="Your answer"
        />
        <Btn type="submit" tone="amber" disabled={busy || !text.trim()}>
          Reply
        </Btn>
      </form>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-500/60 bg-amber-500/10 p-3">
      <div className="text-xs font-semibold text-amber-300">
        Approval needed — send to <code className="rounded bg-slate-900 px-1">{call.name}</code> webhook
      </div>
      <pre className="max-h-48 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-200">{JSON.stringify(call.payload, null, 2)}</pre>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reason (optional, used if you decline)"
        className="w-full rounded bg-slate-900 p-2 text-xs text-slate-100 outline-none ring-1 ring-amber-600/60"
      />
      <div className="flex gap-2">
        <Btn tone="green" disabled={busy} onClick={() => onAct({ action: "approve_call", tool_use_id: call.tool_use_id })}>
          Approve & send
        </Btn>
        <Btn tone="red" disabled={busy} onClick={() => onAct({ action: "reject_call", tool_use_id: call.tool_use_id, text })}>
          Decline
        </Btn>
      </div>
    </div>
  );
}

function DataPreview({ data }: { data: unknown }) {
  if (Array.isArray(data) && data.every((d) => d && typeof d === "object" && "url" in d)) {
    return (
      <ul className="mt-1 space-y-0.5">
        {(data as { title?: string; url: string }[]).slice(0, 8).map((d) => (
          <li key={d.url} className="truncate">
            <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
              {d.title || d.url}
            </a>
          </li>
        ))}
      </ul>
    );
  }
  return <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-950 p-1.5 text-[10px] text-slate-300">{JSON.stringify(data, null, 2)}</pre>;
}

export function Btn({
  tone = "slate",
  className = "",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "slate" | "blue" | "green" | "amber" | "red" }) {
  const tones = {
    slate: "bg-slate-600 hover:bg-slate-500",
    blue: "bg-blue-600 hover:bg-blue-500",
    green: "bg-green-600 hover:bg-green-500",
    amber: "bg-amber-600 hover:bg-amber-500",
    red: "bg-red-600 hover:bg-red-500",
  };
  return (
    <button
      type="button"
      {...p}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    />
  );
}
