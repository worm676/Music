import type { NextConfig } from "next";

// Expose the public Supabase values to the browser under the env names the
// project uses (SUPABASE_URL / SUPABASE_ANON_KEY) so nothing has to be duplicated.
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "",
  },
};

export default nextConfig;
