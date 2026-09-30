import "server-only";
import { addSteps, step, store } from "./store";
import { postWebhook } from "./tools";
import type { Task, ToolResult } from "./types";

export type TaskAction =
  | { action: "answer"; tool_use_id: string; text: string }
  | { action: "approve_call"; tool_use_id: string }
  | { action: "reject_call"; tool_use_id: string; text?: string }
  | { action: "approve" }
  | { action: "revise"; text: string }
  | { action: "retry" };

/** Record the outcome of one pending tool call; when none remain, send all results back and requeue. */
async function resolve(task: Task, result: ToolResult, logText: string, kind: "user" | "tool_result" | "error") {
  const pa = task.pending_action;
  if (!pa || !pa.pending.some((p) => p.tool_use_id === result.tool_use_id)) throw new Error("Nothing pending with that id.");
  const pending = pa.pending.filter((p) => p.tool_use_id !== result.tool_use_id);
  const results = [...pa.results, result];
  if (pending.length > 0) {
    return addSteps(task.id, [step(kind, logText)], { pending_action: { results, pending }, status: "needs_input" });
  }
  const conversation = [...(task.conversation ?? []), { role: "user", content: results }];
  return addSteps(task.id, [step(kind, logText)], { pending_action: null, conversation, status: "queued" });
}

export async function applyAction(id: string, a: TaskAction): Promise<Task> {
  const s = store();
  const task = await s.get(id);
  if (!task) throw new Error("Task not found.");

  switch (a.action) {
    case "answer": {
      const text = a.text.trim();
      if (!text) throw new Error("Answer is empty.");
      return resolve(task, { type: "tool_result", tool_use_id: a.tool_use_id, content: text }, `You answered: ${text}`, "user");
    }
    case "approve_call": {
      const call = task.pending_action?.pending.find((p) => p.tool_use_id === a.tool_use_id);
      if (!call || call.kind !== "approval") throw new Error("No approval pending with that id.");
      // Atomic claim so a double click (or two operators) can't send the same call twice.
      const claimed = await s.claim(id, "needs_input", "working");
      if (!claimed) throw new Error("This task is already being processed.");
      const r = await postWebhook(call.name, call.payload);
      return resolve(
        claimed,
        { type: "tool_result", tool_use_id: a.tool_use_id, content: `Operator approved. ${r.content}`, is_error: !r.ok },
        `Approved "${call.name}" webhook. ${r.content}`,
        r.ok ? "tool_result" : "error",
      );
    }
    case "reject_call": {
      const reason = a.text?.trim();
      return resolve(
        task,
        {
          type: "tool_result",
          tool_use_id: a.tool_use_id,
          content: `Operator declined this call; nothing was sent.${reason ? ` Reason: ${reason}` : ""}`,
          is_error: true,
        },
        `Declined the webhook call.${reason ? ` Reason: ${reason}` : ""}`,
        "user",
      );
    }
    case "approve":
      if (task.status !== "done") throw new Error("Only finished tasks can be approved.");
      return addSteps(id, [step("user", "Result approved.")], { approved_at: new Date().toISOString() });
    case "revise": {
      const text = a.text.trim();
      if (!text) throw new Error("Tell the agent what to change.");
      if (task.status === "working" || task.status === "queued") throw new Error("Task is already running.");
      const conversation = task.conversation?.length
        ? [...task.conversation, { role: "user", content: `Revision requested by the operator:\n${text}\n\nReturn the full revised deliverable.` }]
        : null;
      return addSteps(id, [step("user", `Revision requested: ${text}`)], {
        conversation,
        instructions: conversation ? task.instructions : `${task.instructions}\n\nRevision notes: ${text}`,
        pending_action: null,
        approved_at: null,
        status: "queued",
      });
    }
    case "retry":
      if (task.status === "working") throw new Error("Task is already running.");
      return s.update(id, {
        status: "queued",
        steps: [step("user", "Retry requested — starting over.")],
        result: null,
        conversation: null,
        pending_action: null,
        approved_at: null,
      });
  }
}
