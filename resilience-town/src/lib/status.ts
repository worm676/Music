import type { Task, TaskStatus } from "./types";

export type AgentStatus = "idle" | "working" | "done" | "needs_input" | "error";

export const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "#8b93a1",
  working: "#3b82f6",
  done: "#22c55e",
  needs_input: "#f59e0b",
  error: "#ef4444",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  done: "Done — review",
  needs_input: "Needs you",
  error: "Error",
};

export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  queued: "#8b93a1",
  working: STATUS_COLOR.working,
  needs_input: STATUS_COLOR.needs_input,
  done: STATUS_COLOR.done,
  error: STATUS_COLOR.error,
};

/** needs_input > working > latest outcome (error, or done-but-unapproved) > idle. */
export function agentStatus(tasks: Task[], agentId: string): AgentStatus {
  const mine = tasks.filter((t) => t.agent_id === agentId);
  if (mine.some((t) => t.status === "needs_input")) return "needs_input";
  if (mine.some((t) => t.status === "working")) return "working";
  const latest = mine
    .filter((t) => t.status === "done" || t.status === "error")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (latest?.status === "error") return "error";
  if (latest?.status === "done" && !latest.approved_at) return "done";
  return "idle";
}
