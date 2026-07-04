# Loam — Stack

Chosen deliberately for the capture spine, rich animated UI, an interactive
Android homescreen widget, and push. One backend, two client surfaces, one
ingestion contract.

| Layer | Choice | Notes |
|---|---|---|
| Web / PWA | **Next.js (App Router) + TypeScript** | Install-to-homescreen, offline capture, web push |
| Styling | **Tailwind CSS + CSS custom properties** | Token-driven, light + dark, muted low-chroma palette |
| Motion | **Motion (Framer Motion)** | Subtle, interruptible animation; smooth navigation |
| Data viz | **visx + Motion** | SVG-level control for animated, on-brand charts |
| Backend | **Supabase** | Postgres + Edge Functions + Storage + Auth (project `loam`, eu-central-1) |
| Android | **native Kotlin companion** | Interactive homescreen widget + Health Connect change-token sync + FCM |
| Push | **FCM** (Android) + **Web Push** (PWA) | Proactive surfacing on both surfaces |

Both client surfaces write through the single `/ingest` Edge Function and read
the same Supabase project. Nothing is bespoke per surface.

## Ingestion endpoint (live)

- **Function:** `ingest` (Supabase Edge Function, `verify_jwt` off, custom auth)
- **URL:** `https://eszxpusqgwwcyndzjzot.supabase.co/functions/v1/ingest`
- **Auth:** header `x-loam-key` must equal `app_config.ingest_secret`. Fail-closed.
- **Payload:** see `docs/ARCHITECTURE.md` section 4 (the ingestion contract).
- **Behavior:** idempotent upsert by `(source, dedup_key)`; captures at
  `status = captured`; optional `measurements` attached on first capture.
  Enrichment (classify, summarize to markdown, tag, link) is the next pipeline stage.

Registered sources: `manual`, `telegram`, `share_sheet`, `voice`,
`health_connect`, `bank_csv`.

## Build order (v1)

1. **Capture → enrich → store → resurface** — `ingest` done; enrichment next.
2. Assistant (two-way Telegram + voice).
3. Projects/clients CRM (migrate 80 clients + 69 projects).
4. Learning + correlations + briefings.
5. Health + finance ingestion (native change-token Android sync).
