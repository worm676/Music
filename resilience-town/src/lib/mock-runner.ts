import "server-only";
import { buildingById, type AgentConfig } from "@/config/agents";
import { addSteps, step, store } from "./store";
import type { Task } from "./types";

/**
 * Demo mode used when ANTHROPIC_API_KEY is not set: walks through the same
 * statuses, pauses and approval gates as the real runner with canned output.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMock(task: Task, agent: AgentConfig): Promise<Task> {
  const resumed = (task.conversation?.length ?? 0) > 1;
  const b = buildingById(agent.building);

  if (!resumed) {
    await addSteps(task.id, [step("info", `${agent.name} heads to ${b?.name}. (Demo mode: no ANTHROPIC_API_KEY set.)`)], {
      conversation: [{ role: "user", content: task.title }],
    });
    await wait(2500);
    await addSteps(task.id, [step("thinking", `Reading the brief for "${task.title}" and planning the approach.`)]);
    await wait(2000);

    if (agent.tools.includes("web_search")) {
      await addSteps(task.id, [step("search", `Searching: ${task.title}`)]);
      await wait(1500);
      await addSteps(task.id, [step("tool_result", "Found 8 results (simulated).")]);
      await wait(1000);
    }

    if (agent.id === "chief") {
      const plan = [
        { agent_id: "scout", title: "Research target niches", instructions: `Support goal: ${task.title}. Identify the 3 best niches and 10 leads.` },
        { agent_id: "closer", title: "Draft outreach for target niches", instructions: `Support goal: ${task.title}. Draft a 3-touch outreach sequence.` },
        { agent_id: "spark", title: "Campaign angle", instructions: `Support goal: ${task.title}. Propose one campaign with ad copy.` },
      ];
      for (const p of plan) {
        const child = await store().insert({ ...p, parent_task_id: task.id, priority: task.priority });
        await addSteps(task.id, [step("tool", `Assigned "${p.title}" to ${p.agent_id}.`, { task_id: child.id })]);
        await wait(600);
      }
    }

    if (agent.tools.includes("call_webhook") && agent.id === "keeper") {
      const payload = { action: "upsert_contact", source: "resilience-town", note: task.instructions };
      return addSteps(task.id, [step("approval", 'Wants to call the "crm" webhook — waiting for your approval.', payload)], {
        status: "needs_input",
        pending_action: {
          results: [],
          pending: [{ tool_use_id: `mock_${task.id}`, kind: "approval", tool: "call_webhook", name: "crm", payload }],
        },
      });
    }
  } else {
    await wait(1500);
  }

  const toolNote = resumed ? `\n\n**CRM call:** ${JSON.stringify((task.conversation!.at(-1) as { content: { content: string }[] }).content[0]?.content)}` : "";
  const result = `# ${task.title}

_Demo output from **${agent.name}** (${agent.role}). Add \`ANTHROPIC_API_KEY\` to get real work from Claude._

## Summary
- Brief received: ${task.instructions.slice(0, 180)}${task.instructions.length > 180 ? "…" : ""}
- Priority: **${task.priority}**
- Next step: review and click **Approve**, or **Revise** with notes.${toolNote}`;
  await wait(1200);
  return addSteps(task.id, [step("info", "Done.")], { status: "done", result });
}
