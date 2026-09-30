import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { AGENTS, type AgentConfig } from "@/config/agents";
import { webhooks } from "./env";

/** Webhook names agents may target: whatever is configured, plus the two documented defaults. */
export function webhookNames(): string[] {
  return [...new Set(["crm", "email", ...Object.keys(webhooks())])];
}

export function toolsFor(agent: AgentConfig): Anthropic.Beta.BetaToolUnion[] {
  const tools: Anthropic.Beta.BetaToolUnion[] = [];
  for (const t of agent.tools) {
    switch (t) {
      case "web_search":
        tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 8 });
        break;
      case "call_webhook":
        tools.push({
          name: "call_webhook",
          description:
            "POST a JSON payload to a named n8n/GoHighLevel webhook (e.g. 'crm' for contacts/notes/pipeline, 'email' to send email). Every call is held for the operator's approval before it is sent; the result tells you whether it was approved and what the webhook returned.",
          input_schema: {
            type: "object",
            properties: {
              name: { type: "string", enum: webhookNames(), description: "Which webhook to call." },
              payload: { type: "object", description: "JSON body to send.", additionalProperties: true },
            },
            required: ["name", "payload"],
          },
        });
        break;
      case "ask_user":
        tools.push({
          name: "ask_user",
          description:
            "Ask the operator one specific question and pause until they answer. Use only when a missing fact would materially change the work.",
          input_schema: {
            type: "object",
            properties: { question: { type: "string", description: "The question for the operator." } },
            required: ["question"],
          },
        });
        break;
      case "create_subtask": {
        const team = AGENTS.filter((a) => a.id !== agent.id);
        tools.push({
          name: "create_subtask",
          description:
            "Create a task for another agent. It starts immediately. The instructions must be self-contained: the agent cannot see this conversation.",
          input_schema: {
            type: "object",
            properties: {
              agent_id: {
                type: "string",
                enum: team.map((a) => a.id),
                description: team.map((a) => `${a.id}: ${a.role} — ${a.summary}`).join("\n"),
              },
              title: { type: "string" },
              instructions: { type: "string" },
              priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
            },
            required: ["agent_id", "title", "instructions"],
          },
        });
        break;
      }
    }
  }
  return tools;
}

export async function postWebhook(name: string, payload: unknown): Promise<{ ok: boolean; content: string }> {
  const url = webhooks()[name];
  if (!url) {
    return { ok: false, content: `Webhook "${name}" is not configured (set N8N_WEBHOOK_${name.toUpperCase()}). Nothing was sent.` };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.text()).slice(0, 2000);
    return { ok: res.ok, content: `Sent. Webhook responded HTTP ${res.status}${body ? `: ${body}` : ""}` };
  } catch (e) {
    return { ok: false, content: `Webhook request failed: ${(e as Error).message}. Nothing confirmed as sent.` };
  }
}
