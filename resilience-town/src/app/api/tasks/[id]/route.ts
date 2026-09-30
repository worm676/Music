import { NextResponse } from "next/server";
import { applyAction, type TaskAction } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Operator actions on a task: answer, approve_call, reject_call, approve, revise, retry. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as TaskAction | null;
  if (!body?.action) return NextResponse.json({ error: "Missing action." }, { status: 400 });
  try {
    return NextResponse.json(await applyAction(id, body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
