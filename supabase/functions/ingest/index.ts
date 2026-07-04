// Loam ingestion endpoint — the single write path into the substrate.
//
// Contract (POST JSON):
//   source        required  registered sources.key
//   type          optional  entry type (default "note")
//   content_raw|url|attachments  at least one required
//   source_uid|dedup_key         at least one required (idempotency)
//   occurred_at, tz, title, content_md, domain, metadata, suggested_tags, measurements  optional
//
// Auth: header `x-loam-key` must equal app_config.ingest_secret. Fail-closed:
//   if the secret is missing or the header does not match, the request is rejected.
//
// Idempotency: re-posting the same (source, dedup_key) is a no-op that returns the
//   existing entry. Enrichment (classify, summarize to markdown, tag, link) runs in a
//   later pipeline stage; this endpoint only captures at status = "captured".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1`;

const H: Record<string, string> = {
  apikey: SERVICE_ROLE,
  authorization: `Bearer ${SERVICE_ROLE}`,
  "content-type": "application/json",
};

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-loam-key",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

// Constant-time string comparison to avoid leaking the secret via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // --- auth: shared secret from app_config, fail-closed ---
  let expected = "";
  try {
    const r = await fetch(`${REST}/app_config?select=value&key=eq.ingest_secret`, { headers: H });
    if (!r.ok) return json({ error: "config_unavailable" }, 500);
    const rows = await r.json();
    expected = rows?.[0]?.value ?? "";
  } catch {
    return json({ error: "config_unavailable" }, 500);
  }
  const provided = req.headers.get("x-loam-key") ?? "";
  if (!expected || !safeEqual(provided, expected)) return json({ error: "unauthorized" }, 401);

  // --- parse ---
  let p: Record<string, unknown>;
  try {
    p = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const source = typeof p.source === "string" ? p.source : "";
  const content_raw = typeof p.content_raw === "string" ? p.content_raw : null;
  const url = typeof p.url === "string" ? p.url : null;
  const attachments = Array.isArray(p.attachments) ? p.attachments : null;
  const source_uid = typeof p.source_uid === "string" ? p.source_uid : null;
  const dedup_key = typeof p.dedup_key === "string" ? p.dedup_key : null;
  const measurements = Array.isArray(p.measurements) ? p.measurements : [];

  if (!source) return json({ error: "missing_source" }, 400);
  const hasContent = (content_raw && content_raw.trim()) || url || (attachments && attachments.length);
  if (!hasContent) {
    return json({ error: "missing_content", detail: "one of content_raw, url, attachments is required" }, 400);
  }
  const idkey = dedup_key ?? source_uid;
  if (!idkey) {
    return json({ error: "missing_idempotency_key", detail: "dedup_key or source_uid is required" }, 400);
  }

  // --- resolve source ---
  let src: { id: string; enabled: boolean } | undefined;
  try {
    const r = await fetch(`${REST}/sources?select=id,enabled&key=eq.${encodeURIComponent(source)}`, { headers: H });
    src = (await r.json())?.[0];
  } catch {
    return json({ error: "source_lookup_failed" }, 500);
  }
  if (!src) return json({ error: "unknown_source", detail: `register source '${source}' first` }, 400);
  if (!src.enabled) return json({ error: "source_disabled", detail: source }, 403);

  const occurred_at = typeof p.occurred_at === "string" ? p.occurred_at : new Date().toISOString();
  const tz = typeof p.tz === "string" ? p.tz : "Europe/Amsterdam";

  const row = {
    source_id: src.id,
    type: typeof p.type === "string" && p.type ? p.type : "note",
    title: typeof p.title === "string" ? p.title : null,
    content_md: typeof p.content_md === "string" ? p.content_md : null,
    content_raw,
    url,
    occurred_at,
    tz,
    status: "captured",
    source_uid,
    dedup_key: idkey,
    domain: typeof p.domain === "string" ? p.domain : null,
    metadata: (p.metadata && typeof p.metadata === "object") ? p.metadata : {},
  };

  // --- idempotent insert: ON CONFLICT (source_id, dedup_key) DO NOTHING ---
  let entry: { id: string; status: string } | undefined;
  let deduped = false;
  try {
    const r = await fetch(`${REST}/entries?on_conflict=source_id,dedup_key`, {
      method: "POST",
      headers: { ...H, prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const detail = await r.text();
      return json({ error: "insert_failed", detail }, 500);
    }
    const inserted = await r.json();
    if (Array.isArray(inserted) && inserted.length) {
      entry = { id: inserted[0].id, status: inserted[0].status };
    } else {
      // conflict: fetch the existing row
      deduped = true;
      const r2 = await fetch(
        `${REST}/entries?select=id,status&source_id=eq.${src.id}&dedup_key=eq.${encodeURIComponent(idkey)}`,
        { headers: H },
      );
      entry = (await r2.json())?.[0];
    }
  } catch (e) {
    return json({ error: "insert_failed", detail: String(e) }, 500);
  }
  if (!entry) return json({ error: "insert_failed", detail: "no entry returned" }, 500);

  // --- measurements: only on first capture (skip on dedupe to stay idempotent) ---
  let measurements_written = 0;
  if (!deduped && measurements.length) {
    const mrows = measurements
      .filter((m) => m && typeof m.metric === "string" && typeof m.value === "number")
      .map((m) => ({
        entry_id: entry!.id,
        metric: m.metric,
        value: m.value,
        unit: typeof m.unit === "string" ? m.unit : null,
        observed_at: typeof m.observed_at === "string" ? m.observed_at : occurred_at,
        tz: typeof m.tz === "string" ? m.tz : tz,
        source_id: src.id,
        source_uid: typeof m.source_uid === "string" ? m.source_uid : null,
        metadata: (m.metadata && typeof m.metadata === "object") ? m.metadata : {},
      }));
    if (mrows.length) {
      const rm = await fetch(`${REST}/measurements`, {
        method: "POST",
        headers: { ...H, prefer: "return=minimal" },
        body: JSON.stringify(mrows),
      });
      if (rm.ok) measurements_written = mrows.length;
      // A measurement failure does not fail the capture; the entry is already saved.
      // It is surfaced in the response so nothing is silently dropped.
      else measurements_written = -1;
    }
  }

  return json({
    entry_id: entry.id,
    status: entry.status,
    deduped,
    measurements_written,
  }, deduped ? 200 : 201);
});
