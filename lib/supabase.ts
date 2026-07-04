import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Entry } from "./types";

// Server-only client. Reads with the service role until user auth is wired up.
// Returns null when env is not configured so the app renders an empty state
// instead of crashing (e.g. during build / before .env.local exists).
function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface EntriesResult {
  entries: Entry[];
  configured: boolean;
  error: string | null;
}

export async function fetchEntries(q?: string): Promise<EntriesResult> {
  const c = serviceClient();
  if (!c) return { entries: [], configured: false, error: null };

  let query = c
    .from("entries")
    .select(
      "id,title,content_md,content_raw,type,domain,status,occurred_at,captured_at,url,entry_tags(tags(name))",
    )
    .order("captured_at", { ascending: false })
    .limit(60);

  if (q && q.trim()) {
    const term = q.trim().replace(/[%,()]/g, " ");
    query = query.or(
      `title.ilike.%${term}%,content_md.ilike.%${term}%,content_raw.ilike.%${term}%`,
    );
  }

  const { data, error } = await query;
  if (error) return { entries: [], configured: true, error: error.message };
  return { entries: (data as unknown as Entry[]) ?? [], configured: true, error: null };
}
