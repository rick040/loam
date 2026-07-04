# Loam — Data Architecture

> A single, quiet substrate you dump everything into. It analyzes, connects, and
> resurfaces on its own, so nothing depends on you remembering it exists.

- **Owner:** single-user, Dutch
- **Backend:** Supabase cloud, EU
- **Status:** approved (Phase 4 sign-off), schema-first build
- **Reference material:** `OSLIFE`, `rick-os`, `brain-dump`, `health-sync` were read for intent but are **not** a foundation. Nothing is carried over silently.

---

## 0. The one idea

Every past attempt built one table per data stream and drowned in migrations. Loam inverts that.

Loam is not a set of trackers. It is one composable spine:

- a **qualitative layer** — things you capture, normalized to markdown (`entries`)
- a **quantitative layer** — anything measurable, as a uniform number stream (`measurements`)
- a **generic graph** joining them (`edges`)

Domains like health, finance, projects, and clients are **not tables**. They are *types* and *metadata* on the same few structures. Adding a new life domain or a new capture channel never requires a schema change.

---

## 1. Principles baked into the schema

Each is a lesson taken directly from the four repos, their commit history, and their live data. Constraints, not preferences.

| Principle | What it means |
|---|---|
| **Generic core** | A handful of generic tables. Domain detail lives in JSONB and thin extensions, never a rigid table per stream. |
| **One store** | One database. Data was previously split across two live projects; the assistant literally could not see projects that lived in the other one. |
| **Fail loud** | Every capture carries a visible processing state. A failed enrichment is shown and retryable, never silently dropped. |
| **Idempotent** | Every ingest carries a dedup key. Same-day multiples are never overwritten. This is what lost weight data before. |
| **Time, once** | Every timestamp stores UTC plus an IANA zone (`Europe/Amsterdam`). "Today" is derived, never frozen at module load. Dates were the #1 historical bug class. |
| **Earned insight** | No hardcoded correlations. A link surfaces only after repeated co-occurrence clears a confounder check, then you confirm it. |
| **Manual wins** | Every AI-set tag or fact is editable, and the manual edit always beats the model. |
| **No spec creep** | Ships with Postgres full-text only. The previous vector store sat at 0 rows. Embeddings are added if and when retrieval needs them. |

---

## 2. The model at a glance

Nine core structures in three bands. Everything else in Loam is a row in one of these.

**Substrate — what everything is made of**

- `sources` — registry of channels. A new channel is a row, not a migration.
- `entries` — universal capture. Markdown content, any type, processing state, time metadata.
- `measurements` — uniform numeric stream. Any quantifiable signal from any domain, one shape.
- `entities` — durable nouns: people, clients, projects, accounts, habits, goals.
- `edges` — generic graph. Links any node to any node with a typed relationship.
- `tags` / `entry_tags` — many-to-many labels, each with origin and confidence.

**Memory — time and knowledge**

- `events` — first-class timestamped completions and activity. The reward + audit primitive.
- `facts` — self-evolving knowledge about the user. Asserted or inferred, with evidence and confidence.

**Engines — things that read the substrate and act**

- `correlations` — detected metric-to-metric links, confounder-checked before they surface.
- `surfacing_rules` / `surfaced_log` — time / condition / staleness triggers, plus a record of what was surfaced and whether it was acted on.

---

## 3. Core tables

Types are indicative Postgres types. `metadata jsonb` absorbs everything domain-specific so the shape never has to change. Fields marked *open vocabulary* are intentionally **not** constrained by an enum, so new values need no migration.

### `entries` — the universal capture

One row per thing captured or received: a voice note, link, email, idea, transaction, workout, check-in. Content is normalized to markdown so it doubles as the browsable note database.

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `source_id` | uuid → sources | Where it came from. Never null |
| `type` | text | *Open vocabulary*: note, link, media, voice, task, idea, transaction, email, message, checkin, reflection, workout… |
| `title` | text | AI or user title |
| `content_md` | text | **Canonical markdown.** The clean, enriched note |
| `content_raw` | text | Original untouched input / transcript, preserved |
| `url` | text | Source link if any |
| `occurred_at` | timestamptz | When the thing happened (UTC) |
| `captured_at` | timestamptz | When it entered Loam |
| `tz` | text | IANA zone, e.g. `Europe/Amsterdam` |
| `estimated_duration` | interval | For time-blindness rendering later |
| `deadline` | timestamptz | Due date where applicable |
| `recurrence` | text | RRULE string for repeating items |
| `status` | text | `captured → processing → enriched → linked`, or `failed` / `archived` |
| `confidence` | numeric | Enrichment confidence 0–1 |
| `source_uid` | text | External record id (Health Connect `metadata.id`, Gmail id…) |
| `dedup_key` | text | Idempotency. `UNIQUE (source_id, dedup_key)` |
| `domain` | text | Soft grouping: work / personal / health / finance… |
| `metadata` | jsonb | All domain-specific structured fields |
| `error` | text | Set when `status = failed`. The visible not-saved signal |
| `created_at` / `updated_at` | timestamptz | Row audit |

*Serves executive dysfunction + time blindness:* only `source` and content are required to capture; everything else is filled in later, automatically. Time columns give a future UI enough structure to render deadlines and durations spatially.

### `measurements` — the uniform number stream

Any quantifiable signal, from any domain, in one shape. Steps, sleep minutes, weight, body fat, screen minutes, euros spent, energy level. This is the single place correlations run.

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `entry_id` | uuid → entries | Nullable. Links a number back to its source note |
| `metric` | text | *Open vocabulary*: `sleep_min`, `steps`, `weight_kg`, `body_fat_pct`, `screen_min`, `spend_eur`, `energy`, `mood`… |
| `value` | numeric | The measured value |
| `unit` | text | Explicit unit, no guessing |
| `observed_at` | timestamptz | When measured (UTC) |
| `tz` | text | Local zone at observation |
| `source_id` | uuid → sources | Channel of origin |
| `source_uid` | text | Health Connect / external UID. `UNIQUE (source_id, source_uid)` |
| `metadata` | jsonb | Provenance, device, data-origin package, quality flags |

*Fixes the health-sync data loss:* keyed on the record UID, not the date. Three weigh-ins in one day are three rows, not one overwrite. A late-edited sleep record upserts in place and keeps the newest `last_modified`.

### `entities` — the durable nouns

Things that persist and that entries attach to. The 80 clients and 69 projects become first-class entities managed inside Loam, with no Notion in the loop.

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `type` | text | *Open vocabulary*: person, client, project, organization, place, account, subscription, habit, goal, vendor… |
| `name` | text | Display name |
| `status` | text | Lifecycle per type (active, lead, done, paused…) |
| `metadata` | jsonb | Type-specific fields: deadline, value, follow-up cycle, contract end, aliases, scope… |
| `external_ref` | text | Migration provenance (old Notion / Supabase id), for traceability |
| `created_at` / `updated_at` | timestamptz | Row audit |

### `edges` — connect anything to anything

The generic relationship mechanism. Any node type to any node type, typed, weighted, attributed.

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `src_kind` / `src_id` | text / uuid | From node: entry \| entity \| measurement \| event \| fact |
| `dst_kind` / `dst_id` | text / uuid | To node, same set |
| `rel` | text | *Open vocabulary*: about, mentions, belongs_to, blocks, waiting_on, part_of, caused_by, correlates_with, duplicate_of… |
| `weight` | numeric | Strength / relevance |
| `origin` | text | ai \| manual \| rule |
| `metadata` | jsonb | Evidence, timestamps, context |

### `tags` / `entry_tags` — labels with provenance

| `tags` | Type | | `entry_tags` | Type |
|---|---|---|---|---|
| `id` | uuid | | `entry_id` | uuid → entries |
| `name` | text (unique) | | `tag_id` | uuid → tags |
| `kind` | text | | `origin` | ai \| manual \| rule |
| `origin` | text | | `confidence` | numeric |

### `events` — first-class completions

Discrete, timestamped events as real objects, not boolean status flags. A reward layer, streaks, and progress deltas build on this with zero re-architecture.

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `type` | text | *Open vocabulary*: completed, checked_in, captured, enriched, nudge_sent, streak_hit, dismissed, followed_up… |
| `subject_kind` / `subject_id` | text / uuid | What the event is about |
| `occurred_at` | timestamptz | When it happened (UTC) |
| `value` | numeric | Optional delta (progress %, minutes, count) |
| `metadata` | jsonb | Context for the reward / audit layer |

*Serves dopamine deficiency:* because completions are logged events rather than a flipped flag, streaks and "you did 4 more than last week" are just queries.

### `facts` — self-evolving knowledge about you

The learning layer: dynamic, evidence-based, no fixed category list. **Asserted** facts are ground truth ("ParkingYou, marketing, payroll, 24h/week, contract until 12 Nov"). **Inferred** facts start as a hypothesis and are promoted only once they recur enough to clear a threshold.

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `statement` | text | The fact, in plain language |
| `category` | text | Free text, created / merged / retired by the system. Not an enum |
| `kind` | text | asserted \| inferred |
| `status` | text | hypothesis \| confirmed \| refuted \| retired |
| `confidence` | numeric | 0–1, rises with evidence, decays without |
| `evidence_count` | int | How many observations support it |
| `first_seen` / `last_seen` | timestamptz | Recency window |
| `valid_until` | timestamptz | Expiry for time-bound facts (e.g. the Nov 12 contract) |
| `origin` | text | ai \| manual \| rule. Manual always wins |
| `superseded_by` | uuid → facts | Points to the fact that replaced it |
| `metadata` | jsonb | Supporting entry / measurement / correlation ids |

*Serves object permanence:* the system never forgets what it learned and never presents a fixed taxonomy. Confirmed and asserted facts feed every briefing and assistant reply.

### `correlations` — earned, not assumed

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `metric_a` / `metric_b` | text | The two signals |
| `method` | text | pearson, spearman, lagged… |
| `coefficient` | numeric | Strength |
| `lag_days` | int | Offset (yesterday's sleep vs today's mood) |
| `sample_size` | int | Observations behind it |
| `significance` | numeric | p-value or equivalent |
| `time_window` | text | Time range considered (`window` is a reserved SQL keyword) |
| `status` | text | candidate \| surfaced \| confirmed \| dismissed |
| `evidence` | jsonb | Supporting data + confounder-check result |
| `detected_at` / `reviewed_at` | timestamptz | Lifecycle |

A candidate is written only if it clears minimum sample size and significance. A confounder pass (e.g. fixed-weekday spend = grocery day, not deadline stress) runs before it is ever surfaced. Confirmed → becomes a `fact`; dismissed → suppressed.

### `surfacing_rules` / `surfaced_log` — object permanence engine

| `surfacing_rules` | Type | | `surfaced_log` | Type |
|---|---|---|---|---|
| `id` | uuid | | `id` | uuid |
| `name` | text | | `rule_id` | uuid → surfacing_rules |
| `trigger_kind` | schedule \| condition \| staleness \| correlation | | `subject_kind` / `subject_id` | text / uuid |
| `definition` | jsonb | | `channel` | text |
| `channel` | text | | `surfaced_at` | timestamptz |
| `cadence` | text | | `outcome` | acted \| dismissed \| ignored \| snoozed |
| `enabled` | bool | | `metadata` | jsonb |

Outcomes feed learning about what the user acts on versus ignores.

---

## 4. The ingestion contract

The load-bearing promise: adding a new capture channel later never touches the schema. A channel registers one `sources` row, then posts this payload to a single endpoint.

```jsonc
// POST /ingest  -> returns { entry_id, status }
{
  "source": "telegram",          // must be a registered source key
  "type": "voice",
  "occurred_at": "2026-07-04T21:12:00Z",
  "tz": "Europe/Amsterdam",
  "source_uid": "tg:8842:voice", // idempotency; re-posts are no-ops
  "content_raw": "...transcript or text...",
  "url": null,
  "attachments": [{ "storage_path": "...", "mime": "audio/ogg" }],
  "metadata": { /* anything the channel knows */ },
  "suggested_tags": ["idea"],    // optional hints, AI may override
  "measurements": [              // optional, for quantified sources
    { "metric": "weight_kg", "value": 68.9, "unit": "kg", "observed_at": "..." }
  ]
}
```

**Required:** `source`, one of `content_raw` / `url` / `attachments`, and an idempotency key (`source_uid` or `dedup_key`). Everything else is optional.

**Pipeline states, all visible:**

```
captured -> processing -> enriched -> linked      | failed (retryable)
```

- **enriched** = classified (type, domain), summarized into `content_md`, tagged, numbers extracted into `measurements`.
- **linked** = edges drawn to related entries and to entities.
- **failed** = the error is stored on the row and shown. Nothing dropped silently; retryable.

*Serves executive dysfunction:* capture is one tap, paste, forward, or voice note. Zero structuring at capture time.

---

## 5. How the engines read the substrate

- **Learning → persona profile.** A scheduled job reads recent `entries`, `measurements`, and `events`, distills candidate `facts`, and updates confidence. Recurrence promotes a hypothesis to confirmed; silence decays it. Manual edits are locked. The assistant's persona profile is simply the set of confirmed + asserted facts, assembled into its prompt. No separate profile store to drift.
- **Correlation → earned.** Aligns pairs of `measurements` by day and lag; writes a candidate only past sample-size and significance floors; runs a confounder pass before surfacing; you confirm or dismiss.
- **Surfacing → nothing depends on memory.** `surfacing_rules` fire on schedule, condition, staleness, or a confirmed correlation. Fired items land in `surfaced_log` with their outcome.

---

## 6. Cognitive requirements, mapped

| Requirement | How the model serves it | Structures |
|---|---|---|
| **Executive dysfunction** | One `/ingest` endpoint; only source + content required; all structuring async and post-capture. No form, no setup, no blank canvas. | sources, entries, pipeline |
| **Object permanence** | Rule / time / staleness triggers resurface items automatically; open loops and follow-ups modeled as edges and facts. | surfacing_rules, surfaced_log, edges, facts, events |
| **Time blindness** | Structured time on every entry: occurred_at + tz, estimated_duration, deadline, recurrence. Measurements give elapsed and trend. | entries, measurements |
| **Dopamine deficiency** | Completions are first-class timestamped events, not flags. Streaks and deltas are queries. | events |

---

## 7. What Loam keeps, and what it refuses

**Deliberately kept as ideas (re-justified, not copied):**

- The generic capture row (`entries` / `braindump_entries.markdown`) — the seed of the right model, now generalized.
- Learned-value with origin + manual-wins (`vendor_tags` pattern) — becomes the rule across tags and facts.
- Follow-up cycles and a reward surface — map onto `surfacing_rules` and `events`.
- Cheap-first classification before an LLM call — kept as an enrichment principle.

**Deliberately refused:**

- One-table-per-stream — the documented cause of migration and casing-drift pain.
- The vector / hybrid-search layer — built, sat at 0 rows. Cut from v1.
- Any Notion connection — fully severed. History imported once, then gone.
- Split databases and duplicated plumbing — one store, one backend, one ingestion path.
- Ephemeral AI output — no localStorage-only insights or in-memory chat. Everything the AI concludes is a durable row.

---

## 8. Migration (later and deliberate)

After the schema exists and is approved, not before. Everything maps onto the generic core with no bespoke tables.

| Existing data | Rows | Lands as |
|---|---|---|
| Clients (oslife, all Notion-origin) | 80 | `entities` · type=client |
| Projects (oslife) | 69 | `entities` · type=project + edge belongs_to client |
| Health Connect timeseries (rick-os) | ~900d | `measurements` (+ entries for workouts) |
| Finance transactions (both, merged + deduped) | ~730 | `entries` · type=transaction + `measurements` · spend_eur |
| Your captures (entries + braindumps) | ~33 | `entries` |
| Dog log | ~50 | `entries` · type=dog_log + `events` |
| Habits & goals | small | `entities` + `events` + `measurements` |
| Learned facts (heyra_memory, brain_state) | handful | `facts` · seeded |
| Gmail & calendar | ~2k | dropped, re-synced live |
| AI insights, notification logs, 30 empty tables | — | not migrated |

---

## 9. Decisions on record

| # | Decision | Choice |
|---|---|---|
| 1 | Repo | Own clean repo `rick040/loam` |
| 2 | Layer split | `entries` + `measurements` kept separate |
| 3 | Markdown export | `content_md` in Postgres **and** exported as `.md` files to Storage |
| 4 | Health Android app | Contract designed now; native change-token sync app built at v1 step 5 |
| 5 | Vectors | None in v1; Postgres full-text only |
| 6 | Stack | Decided at build start (leaning Next.js + Supabase) |

**v1 build order:** 1) capture → enrich → store → resurface · 2) assistant (two-way Telegram + voice) · 3) projects/clients CRM · 4) learning + correlations + briefings · 5) health + finance ingestion.
