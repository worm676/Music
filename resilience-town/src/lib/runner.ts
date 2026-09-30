import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AGENTS, agentById, buildingById, type AgentConfig } from "@/config/agents";
import { hasAnthropic } from "./env";
import { runMock } from "./mock-runner";
import { addSteps, step, store } from "./store";
import { toolsFor, webhookNames } from "./tools";
import type { PendingCall, Priority, Step, Task, ToolResult } from "./types";

type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlock;

export const MODEL = "claude-opus-5-5";
/** Stop starting new model turns after this long so the serverless function can save and exit. */
const TIME_BUDGET_MS = 230_000;
const MAX_TURNS = 30;

export function taskPrompt(task: Task): string {
  return [
    `Task: ${task.title}`,
    `Priority: ${task.priority}${task.due_date ? ` · Due: ${task.due_date}` : ""}`,
    task.parent_task_id ? "Assigned by Chief as part of a larger goal." : null,
    "",
    "Instructions:",
    task.instructions || "(none — use the title)",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Claim a queued task and run it until it finishes, pauses for the operator, or runs out of time. */
export async function runTask(taskId: string): Promise<Task | null> {
  const s = store();
  const task = await s.claim(taskId, "queued", "working");
  if (!task) return null;
  const agent = agentById(task.agent_id);
  if (!agent) return addSteps(task.id, [step("error", `Unknown agent "${task.agent_id}"`)], { status: "error" });

  try {
    return hasAnthropic() ? await runClaude(task, agent) : await runMock(task, agent);
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `Claude API error ${e.status}: ${e.message}` : (e as Error).message;
    return addSteps(task.id, [step("error", msg)], { status: "error" });
  }
}

async function runClaude(task: Task, agent: AgentConfig): Promise<Task> {
  const s = store();
  const client = new Anthropic();
  const started = Date.now();
  let messages: Msg[] = (task.conversation as Msg[] | null) ?? [];

  if (messages.length === 0) {
    messages = [{ role: "user", content: taskPrompt(task) }];
    const b = buildingById(agent.building);
    await addSteps(task.id, [step("info", `${agent.name} heads to ${b?.name ?? "work"}.`)], { conversation: messages });
  } else {
    await addSteps(task.id, [step("info", `${agent.name} resumes work.`)]);
  }

  const system = `${agent.systemPrompt}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}.`;
  const tools = toolsFor(agent);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      return addSteps(task.id, [step("info", "Checkpoint saved; continuing in a new run.")], {
        status: "queued",
        conversation: messages,
      });
    }

    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      tools,
      messages,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      // On a safety-classifier refusal, the API re-runs the request on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    messages = [...messages, { role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] }];
    const turnSteps = describe(res.content);

    if (res.stop_reason === "pause_turn") {
      await addSteps(task.id, turnSteps, { conversation: messages });
      continue;
    }
    if (res.stop_reason === "refusal") {
      const why = res.stop_details?.explanation ?? "The request was declined.";
      return addSteps(task.id, [...turnSteps, step("error", `Refused: ${why}`)], { status: "error", conversation: messages });
    }
    if (res.stop_reason !== "tool_use") {
      const text = finalText(res.content);
      const truncated = res.stop_reason === "max_tokens";
      return addSteps(
        task.id,
        [...turnSteps, truncated ? step("error", "Hit the output limit; result is partial.") : step("info", "Done.")],
        {
          status: truncated ? "error" : "done",
          result: text || "_No written output._",
          conversation: messages,
          pending_action: null,
        },
      );
    }

    // Client tool calls: run the safe ones now, hold the ones that need the operator.
    const results: ToolResult[] = [];
    const pending: PendingCall[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const input = (block.input ?? {}) as Record<string, unknown>;
      const r = await handleTool(task, agent, block.id, block.name, input, turnSteps);
      if ("pending" in r) pending.push(r.pending);
      else results.push(r.result);
    }

    if (pending.length > 0) {
      return addSteps(task.id, turnSteps, {
        status: "needs_input",
        conversation: messages,
        pending_action: { results, pending },
      });
    }
    messages = [...messages, { role: "user", content: results }];
    await addSteps(task.id, turnSteps, { conversation: messages });
  }

  return addSteps(task.id, [step("error", `Stopped after ${MAX_TURNS} turns without finishing.`)], {
    status: "error",
    conversation: messages,
  });
}

async function handleTool(
  task: Task,
  agent: AgentConfig,
  id: string,
  name: string,
  input: Record<string, unknown>,
  log: Step[],
): Promise<{ result: ToolResult } | { pending: PendingCall }> {
  const err = (content: string) => {
    log.push(step("error", `${name}: ${content}`));
    return { result: { type: "tool_result" as const, tool_use_id: id, content, is_error: true } };
  };
  const allowed = agent.tools as string[];
  if (!allowed.includes(name)) return err(`Tool "${name}" is not available to ${agent.name}.`);

  switch (name) {
    case "ask_user": {
      const question = String(input.question ?? "").trim();
      if (!question) return err("question is required.");
      log.push(step("question", question));
      return { pending: { tool_use_id: id, kind: "question", question } };
    }
    case "call_webhook": {
      const hook = String(input.name ?? "");
      if (!webhookNames().includes(hook)) return err(`Unknown webhook "${hook}". Use one of: ${webhookNames().join(", ")}.`);
      if (typeof input.payload !== "object" || input.payload === null) return err("payload must be a JSON object.");
      log.push(step("approval", `Wants to call the "${hook}" webhook — waiting for your approval.`, input.payload));
      return { pending: { tool_use_id: id, kind: "approval", tool: "call_webhook", name: hook, payload: input.payload } };
    }
    case "create_subtask": {
      const target = AGENTS.find((a) => a.id === input.agent_id && a.id !== agent.id);
      const title = String(input.title ?? "").trim();
      if (!target) return err(`Unknown agent "${String(input.agent_id)}".`);
      if (!title) return err("title is required.");
      const priority = (["low", "normal", "high", "urgent"] as Priority[]).includes(input.priority as Priority)
        ? (input.priority as Priority)
        : "normal";
      const child = await store().insert({
        agent_id: target.id,
        title,
        instructions: String(input.instructions ?? ""),
        priority,
        parent_task_id: task.id,
      });
      log.push(step("tool", `Assigned "${title}" to ${target.name}.`, { task_id: child.id }));
      return { result: { type: "tool_result", tool_use_id: id, content: `Created task ${child.id} for ${target.name}. It is now queued.` } };
    }
    default:
      return err(`Unknown tool "${name}".`);
  }
}

function describe(content: Block[]): Step[] {
  const out: Step[] = [];
  for (const b of content) {
    switch (b.type) {
      case "thinking":
        if (b.thinking.trim()) out.push(step("thinking", clip(b.thinking, 800)));
        break;
      case "text":
        if (b.text.trim()) out.push(step("text", clip(b.text, 1200)));
        break;
      case "server_tool_use":
        if (b.name === "web_search") out.push(step("search", `Searching: ${(b.input as { query?: string }).query ?? ""}`));
        break;
      case "web_search_tool_result":
        if (Array.isArray(b.content)) {
          const hits = b.content.map((r) => ({ title: r.title, url: r.url }));
          out.push(step("tool_result", `Found ${hits.length} results.`, hits));
        } else {
          out.push(step("error", `Web search error: ${b.content.error_code}`));
        }
        break;
      case "tool_use":
        break; // logged by handleTool
      default:
        if ((b as { type: string }).type === "fallback") out.push(step("info", "Switched to a fallback model for this turn."));
    }
  }
  return out;
}

function finalText(content: Block[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
