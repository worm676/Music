import { NextResponse } from "next/server";
import { runTask } from "@/lib/runner";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
// Agent loops checkpoint before this limit and are re-dispatched if unfinished.
export const maxDuration = 300;

/**
 * Run a queued task. Body `{ taskId }` targets one task; with no body it picks
 * the oldest queued task (handy for a cron or n8n schedule).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { taskId?: string };
  const id = body.taskId ?? (await store().oldestQueued())?.id;
  if (!id) return NextResponse.json({ ran: false, reason: "No queued tasks." });
  const task = await runTask(id);
  if (!task) return NextResponse.json({ ran: false, reason: "Task is not queued (already claimed or finished)." });
  return NextResponse.json({ ran: true, task });
}

export const GET = POST;
