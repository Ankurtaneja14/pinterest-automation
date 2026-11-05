# Architecture

## System boundaries

```text
Browser dashboard
    |
    v
Next.js App Router + server-side API
    |                         \
    v                          v
Prisma / SQLite           Managed file storage
    ^
    |
Independent Node.js worker + persistent scheduler
    |             |              |
    v             v              v
AI adapter     Research adapter   Image upload/validation
```

The initial deployment is a single-user modular monolith. The dashboard and
API handle short validation, configuration, and query operations. A separate
worker process owns long-running research, generation, export, and provider calls.
Both processes share SQLite and application-managed storage. SQLite is the
source of truth; Excel files are interfaces and exports.

## Module responsibilities

- `src/app`: App Router pages, layouts, and route handlers.
- `src/components`: Reusable dashboard and domain UI.
- `src/server`: Server-only services, schemas, adapters, and configuration.
- `src/worker`: Independently started queue processor and scheduler.
- `prisma`: Relational schema and checked-in migrations.
- `storage`: Runtime-only uploads, generated images, execution artifacts, and
  logs; never source-controlled.
- `tests`: Unit and integration tests using controlled test dependencies.

As the implementation grows, organize server modules by domain:
`excel`, `ai`, `research`, `ideas`, `content`, `images`, `execution`, and
`storage`. Hugging Face Inference image generation is isolated from research
and text generation in its own server-side adapter.

## Execution lifecycle

1. Validate an uploaded workbook and preview row-level issues.
2. Upsert schedule rows using a stable schedule identity; preserve source
   workbook data.
3. Scheduler checks eligible dates in the configured timezone and creates a
   unique execution record transactionally.
4. Worker claims an eligible job, persists stage transitions, logs events, and
   commits each completed stage before moving forward.
5. Each AI/retrieval/image operation has independent bounded retries and
   explicit failure state. Completed outputs are not regenerated on recovery.
6. Export uses a temporary workbook and atomic replacement where supported.
   Export failure does not discard the persisted pipeline output.
7. Dashboard reads persisted data and exposes validated controls.

Jobs are idempotent by schedule and execution intent. A lease/lock prevents duplicate worker claims. Image generation claims each
selected asset before making a provider request and processes batches
sequentially in the initial deployment.

## Provider and trust boundaries

- AI stages use a common OpenAI-compatible adapter; endpoint, model, parameters,
  timeout, and retry policy are configuration, not hardcoded provider choices.
- Research retrieval is independent of the model. Four concurrent public Bing
  RSS searches produce up to 12 deduplicated source snippets; title, URL,
  retrieved date, excerpt, and query relevance are persisted. Every report
  citation is validated against retrieved evidence and mapped to a persisted
  source ID. Snippets and schedule fields are untrusted input, and are not a
  substitute for reviewing the full source page.
- Research sessions are queued transactionally and processed through Next.js
  `after()` in the web process. This keeps work off the response path but does
  not provide durable execution across process restarts; Milestone 9 moves
  processing to the dedicated worker.
- Idea generation consumes a completed report and its stored source excerpts,
  requests bounded structured batches for the schedule's requested idea count,
  validates every source reference, and uses normalized title hashes to avoid
  duplicates. Ideas and source-ID citations are committed together; failures
  are explicit and retryable. Generation currently uses Next.js `after()` and
  the dedicated `idea_generation` AI configuration.
- Idea scoring evaluates valid ideas in bounded batches across seven
  application-weighted dimensions, validates exact score coverage, persists
  score details and selected/rejected ranks transactionally, and greedily
  favors diversity by content format, search intent, and trend classification.
  Selection is capped at the schedule's requested pin count. Scoring currently
  uses Next.js `after()` and the dedicated `idea_evaluation` AI configuration;
  its model assessments are advisory, not measured performance.
- Content generation accepts only selected, valid, scored ideas and creates
  bounded batches of Pinterest titles, descriptions, hashtags, search
  keywords, and vertical-pin image prompts. Provider output is normalized and
  validated against the exact selected idea IDs before persistence. Each batch
  is committed transactionally; retries skip completed packages and preserve
  partial successes. Generation currently uses Next.js `after()` and the
  dedicated `content_generation` AI configuration. The scheduled destination
  URL is attached to each package rather than inferred from provider output.
- Image creation uses the Hugging Face Inference Providers router with an
  encrypted access token and a Hugging Face model ID. The settings test
  generates and decodes an actual image; selected content prompts are then
  sent automatically for individual or sequential batch generation. Requests
  have bounded timeouts/retries, provider errors are recorded with bounded,
  redacted details, and images/uploads are size/decode/dimension validated,
  normalized to WebP, SHA-256 hashed, and stored locally.
- Credentials are only read and used server-side. Persisted secrets are
  encrypted with AES-256-GCM using a deployment-provided 32-byte key; logs and
  API responses redact them. The key must be backed up and kept stable because
  changing it makes existing credentials undecryptable.
- AI configuration is stage-specific and can use one shared provider or
  independent providers. The settings connection test validates a real
  structured response, retries transient failures within the configured retry
  limit, and falls back to prompt-only JSON when native JSON mode is
  unsupported or produces an unusable completion. A router 503 indicating
  that all targets were skipped by pre-dispatch filters also triggers an
  immediate prompt-only retry, bypassing native JSON capability filters.
  OmniRoute Felo thread-creation HTTP 400 responses receive the same
  compatibility retry.
- The initial single-user web process binds to loopback. Browser mutation
  endpoints validate the request origin; user authentication must be added
  before exposing the service beyond the local machine.

## Data and files

Prisma/SQLite stores normalized schedule, original workbook upload, execution,
research, idea, scoring, selection, package, asset, configuration, log, and
storage metadata. Original workbooks, images, and JSON reports live on disk,
addressed by safe relative paths. User-provided niche names never become raw
path segments. Each execution has a manifest to support scoped cleanup and
recovery.

## Initial foundation choices

- Next.js App Router and TypeScript for the web/API layer.
- Tailwind CSS for responsive styling.
- Prisma with SQLite for initial persistence and migrations.
- Zod for external input validation.
- A separately invoked Node worker, added when the execution domain is
  implemented.

## Operational constraints

The web process and worker are separate commands and may be restarted
independently. The worker must recover expired claims and incomplete stages on
startup. The application must report the scheduler/worker health based on
actual process heartbeats, not dashboard-local timers or fabricated values.
