import { NextResponse } from "next/server";
import { agentById } from "@/config/agents";
import { store } from "@/lib/store";
import type { NewTask, Priority } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await store().list());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<NewTask>;
  const title = body.title?.trim();
  if (!body.agent_id || !agentById(body.agent_id)) return NextResponse.json({ error: "Unknown agent." }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });
  const priority: Priority = ["low", "normal", "high", "urgent"].includes(body.priority ?? "") ? body.priority! : "normal";
  try {
    const task = await store().insert({
      agent_id: body.agent_id,
      title,
      instructions: body.instructions?.trim() ?? "",
      priority,
      due_date: body.due_date || null,
    });
    return NextResponse.json(task, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
