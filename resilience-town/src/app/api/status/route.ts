import { NextResponse } from "next/server";
import { hasAnthropic, hasSupabase, webhooks } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ anthropic: hasAnthropic(), supabase: hasSupabase(), webhooks: Object.keys(webhooks()) });
}
