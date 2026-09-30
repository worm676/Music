export type TaskStatus = "queued" | "working" | "needs_input" | "done" | "error";
export type Priority = "low" | "normal" | "high" | "urgent";

export type Step = {
  at: string;
  kind: "info" | "thinking" | "text" | "search" | "tool" | "tool_result" | "approval" | "question" | "user" | "error";
  text: string;
  data?: unknown;
};

/** A tool call that is waiting on the human before the agent can continue. */
export type PendingCall =
  | { tool_use_id: string; kind: "question"; question: string }
  | { tool_use_id: string; kind: "approval"; tool: "call_webhook"; name: string; payload: unknown };

export type ToolResult = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type PendingAction = {
  /** Results already produced for this assistant turn (sent back together once nothing is pending). */
  results: ToolResult[];
  pending: PendingCall[];
};

export type Task = {
  id: string;
  agent_id: string;
  title: string;
  instructions: string;
  priority: Priority;
  due_date: string | null;
  status: TaskStatus;
  result: string | null;
  steps: Step[];
  parent_task_id: string | null;
  /** Anthropic message history, kept so a paused task can resume where it stopped. */
  conversation: unknown[] | null;
  pending_action: PendingAction | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewTask = {
  agent_id: string;
  title: string;
  instructions: string;
  priority?: Priority;
  due_date?: string | null;
  parent_task_id?: string | null;
};
