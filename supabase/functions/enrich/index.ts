// Loam enrichment stage — turns raw captures into clean markdown, a title,
// a domain/type classification, and tags. Moves entries captured -> enriched.
//
// Invocation: POST with header `x-loam-key` (same shared secret as ingest).
//   Body {} processes a batch of pending entries; {"entry_id":"..."} targets one.
// Trigger: a pg_cron job calls this every minute (migration 0004). It no-ops
//   when nothing is pending, so running often is cheap.
//
// Cheap-first: a single Claude Haiku call per entry. Fail-loud: on any error the
//   entry is set to status=failed with the error stored, and can be retried.
// Concurrency: an entry is claimed (captured -> processing) with a conditional
//   update so overlapping runs never double-process the same row.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${SUPABASE_URL}/rest/v1`;
const MODEL = "claude-haiku-4-5-20251001";
const BATCH = 5;

const H: Record<string, string> = {
  apikey: SERVICE_ROLE,
  authorization: `Bearer ${SERVICE_ROLE}`,
  "content-type": "application/json",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function cfg(key: string): Promise<string> {
  const r = await fetch(`${REST}/app_config?select=value&key=eq.${key}`, { headers: H });
  if (!r.ok) return "";
  return (await r.json())?.[0]?.value ?? "";
}

const SYSTEM = [
  "Je bent de verrijkingslaag van Loam, Rick's persoonlijke kennissysteem.",
  "Je krijgt een ruwe opname (tekst, transcript of link). Analyseer en retourneer",
  "UITSLUITEND geldige JSON, geen uitleg eromheen. Velden:",
  "- title: korte titel, max 8 woorden",
  "- content_md: nette markdown-versie van de inhoud, bondig, behoud alle betekenis",
  "- domain: exact een van work, personal, health, finance, social, other",
  "- type: exact een van note, idea, task, link, media, transaction, reflection",
  "- tags: 3 tot 6 korte lowercase tags",
  "- sentiment: getal tussen -1 en 1",
  "- confidence: getal tussen 0 en 1",
  "Regels: schrijf in het Nederlands, wees bondig, verzin niets.",
].join(" ");

interface Enriched {
  title?: string;
  content_md?: string;
  domain?: string;
  type?: string;
  tags?: string[];
  sentiment?: number;
  confidence?: number;
}

async function callClaude(apiKey: string, entry: Record<string, unknown>): Promise<Enriched> {
  const userContent = JSON.stringify({
    type: entry.type ?? null,
    url: entry.url ?? null,
    title: entry.title ?? null,
    content_raw: entry.content_raw ?? null,
  });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no json in model output: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]) as Enriched;
}

async function applyTags(entryId: string, tags: string[]) {
  const clean = [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 6);
  if (!clean.length) return;
  const up = await fetch(`${REST}/tags?on_conflict=name`, {
    method: "POST",
    headers: { ...H, prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(clean.map((name) => ({ name, kind: "auto", origin: "ai" }))),
  });
  if (!up.ok) return;
  const rows: { id: string; name: string }[] = await up.json();
  const links = rows.map((r) => ({ entry_id: entryId, tag_id: r.id, origin: "ai", confidence: 0.7 }));
  await fetch(`${REST}/entry_tags?on_conflict=entry_id,tag_id`, {
    method: "POST",
    headers: { ...H, prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(links),
  });
}

async function claim(id: string): Promise<Record<string, unknown> | null> {
  // captured -> processing, only if still captured (concurrency guard)
  const r = await fetch(`${REST}/entries?id=eq.${id}&status=eq.captured`, {
    method: "PATCH",
    headers: { ...H, prefer: "return=representation" },
    body: JSON.stringify({ status: "processing" }),
  });
  if (!r.ok) return null;
  return (await r.json())?.[0] ?? null;
}

async function enrichOne(apiKey: string, entry: Record<string, unknown>): Promise<"enriched" | "failed"> {
  const id = entry.id as string;
  try {
    const e = await callClaude(apiKey, entry);
    const baseMeta = (entry.metadata && typeof entry.metadata === "object") ? entry.metadata as Record<string, unknown> : {};
    const patch: Record<string, unknown> = {
      title: e.title ?? entry.title ?? null,
      content_md: e.content_md ?? (entry.content_raw ?? null),
      domain: e.domain ?? entry.domain ?? null,
      type: e.type ?? entry.type,
      confidence: typeof e.confidence === "number" ? e.confidence : null,
      status: "enriched",
      error: null,
      metadata: { ...baseMeta, sentiment: e.sentiment ?? null, enriched_by: MODEL },
    };
    const r = await fetch(`${REST}/entries?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...H, prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`entry update ${r.status}: ${(await r.text()).slice(0, 200)}`);
    if (Array.isArray(e.tags)) await applyTags(id, e.tags);
    return "enriched";
  } catch (err) {
    await fetch(`${REST}/entries?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...H, prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", error: String(err).slice(0, 500) }),
    });
    return "failed";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = await cfg("ingest_secret");
  if (!secret || !safeEqual(req.headers.get("x-loam-key") ?? "", secret)) {
    return json({ error: "unauthorized" }, 401);
  }
  const apiKey = await cfg("anthropic_api_key");
  if (!apiKey) return json({ error: "anthropic_key_missing" }, 503);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* empty body is fine */ }

  // Select candidate ids (a specific entry, or a batch of pending ones).
  let ids: string[] = [];
  if (typeof body.entry_id === "string") {
    ids = [body.entry_id];
  } else {
    const r = await fetch(
      `${REST}/entries?select=id&status=eq.captured&order=captured_at.asc&limit=${BATCH}`,
      { headers: H },
    );
    ids = (await r.json()).map((e: { id: string }) => e.id);
  }

  let enriched = 0, failed = 0, skipped = 0;
  for (const id of ids) {
    const claimed = await claim(id);
    if (!claimed) { skipped++; continue; }
    const outcome = await enrichOne(apiKey, claimed);
    outcome === "enriched" ? enriched++ : failed++;
  }

  return json({ processed: ids.length, enriched, failed, skipped });
});
