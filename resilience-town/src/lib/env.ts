export const hasSupabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
export const hasAnthropic = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** All N8N_WEBHOOK_<NAME> env vars, keyed by lowercase name. */
export function webhooks(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("N8N_WEBHOOK_") && v) out[k.slice("N8N_WEBHOOK_".length).toLowerCase()] = v;
  }
  return out;
}
