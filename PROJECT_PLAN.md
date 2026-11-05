# Project Plan

## Objective

Build a single-user Pinterest content production application that turns an Excel
schedule into evidence-backed, scored, diversified Pinterest content packages
and generated images. SQLite is the system of record; Excel is an import/export
interface. The dashboard, API, scheduler, and worker must remain separated, and
long-running work must never run inside an API request.

## Current project assessment

- The workspace was empty at project start; there was no existing application,
  dependency manifest, database, or functionality to preserve.
- Node.js 24 and npm 11 are available.
- The project will start with the requested Next.js App Router, TypeScript,
  Tailwind CSS, SQLite, and Prisma stack.
- Real external API tests require user-provided credentials. Hugging Face
  Inference is used for selected-idea image generation; credentials are entered
  in AI settings and tested with a real image request.

## Architecture decisions

- Use a modular monolith for the web application and a separately launched
  Node.js worker process; avoid microservices for the initial desktop deployment.
- Use Prisma with SQLite for typed persistence and migrations.
- Persist execution stage/checkpoint state in the database. The worker claims
  due jobs under a database lock and starts with one image generation slot.
- Isolate provider adapters for AI, research retrieval, and image validation.
  Never assume an LLM can retrieve current web evidence itself.
- Keep secrets server-side and encrypt stored provider credentials with a
  deployment-managed master key.
- Store generated files on disk under application-managed, sanitized execution
  directories. Store relative paths and metadata in SQLite.
- Treat workbook import as validation and schedule upsert; preserve the input
  sheet and use separate uniquely named result/archive sheets on export.
- Keep provider-dependent integrations configurable and report unavailable or
  failed integrations explicitly rather than returning success-shaped fallbacks.

## Milestones and acceptance criteria

### 1. Project foundation
- Initialize Next.js App Router, TypeScript, Tailwind, linting, and a responsive
  application shell.
- Add SQLite/Prisma schema and initial migration.
- Add environment configuration, startup instructions, and health check.
- Acceptance: dependencies install; Prisma validates/generates; lint and
  TypeScript checks pass; the application starts and its health endpoint works.

### 2. Excel integration
- Parse and validate the `Niche_Schedule` worksheet, preview errors, and store
  idempotent schedules.
- Export selected results and a research archive without overwriting existing
  sheets; use safe, atomic workbook writes.
- Acceptance: focused parser/import/export tests cover valid and malformed
  workbooks, duplicate schedules, worksheet names, and preservation.

### 3. AI provider integration
- Add encrypted server-side configuration, per-stage model selection, a
  provider adapter, structured response validation, and a real connection test.
- Acceptance: secrets are never returned or logged; adapter tests cover
  provider failures, JSON-mode fallback, malformed data, timeouts, transient
  response retries, and usage extraction.

### 4. Research engine
- Add interchangeable retrieval provider interfaces, retrieve current public
  sources, deduplicate/retain evidence, and synthesize a schema-validated report.
- Acceptance: every factual claim can reference retrieved evidence; retrieval
  failures remain visible; no invented citations or fabricated metrics.

### 5. Idea generation
- Generate the requested quantity from the report, classify and validate ideas,
  and detect duplicates before persistence.
- Acceptance: all ideas are saved with source references and duplicate checks.
- Implementation: `/ideas` generates the schedule's requested number in
  bounded batches, validates saved-source citations and idea fields, persists
  ideas transactionally, and avoids duplicate normalized titles.

### 6. Idea scoring
- Validate seven 1–10 dimensions, calculate weighted scores in application
  code, rank ideas, and choose a diverse valid subset.
- Acceptance: unit and SQLite integration tests verify weighted scores,
  ranking, invalid score coverage, diversity selection, persisted selected and
  rejected ranks, and idempotent completion; all outcomes remain inspectable.
- Implementation: `/ideas` scores valid ideas in bounded batches, persists
  seven dimensions and reasoning, and selects up to `Pins_To_Generate` ideas
  using diversity bonuses for format, search intent, and trend classification.

### 7. Content generation
- Produce and validate titles, descriptions, hashtags, keywords, and detailed
  image prompts for selected ideas.
- Acceptance: each package is linked to its idea and destination; incomplete
  results are retried or explicitly failed, never silently accepted.
- Status: Complete. Selected-only generation, batch validation and
  transactional persistence, retry-safe partial success, API, and workspace
  display are implemented and covered by tests. A live run produced complete
  packages for all three selected ideas.

### 8. Hugging Face Inference image workflow
- Configure an encrypted Inference Providers token, model ID, timeout, and
  bounded retry policy in AI settings.
- Acceptance: the settings test makes a real image-generation request and
  validates the returned raster; selected-idea prompts are then submitted
  automatically, images are validated and saved locally, failures are
  explicit, and manual upload remains available.
- Status: API adapter, settings, test endpoint, and automatic image workflow
  are implemented. Live verification requires the user's Hugging Face token,
  credits, and model/provider availability.

### 9. Worker and scheduler
- Add persistent queue claiming, timezone-aware due checks, stage checkpoints,
  retries, pause/resume/cancel, bounded image concurrency, and restart recovery.
- Acceptance: integration tests demonstrate idempotency and recovery without
  repeating completed stages or images.

### 10. Excel output automation
- Export each execution to a safe, unique niche/date sheet and persist all ideas
  in an archive. Retry export independently from successful pipeline stages.
- Acceptance: workbook sheets and database records stay consistent; locked or
  interrupted writes preserve the original workbook.

### 11. Complete dashboard
- Add database-backed overview, schedules, configuration, research, ideas,
  content, execution history, storage, and settings views.
- Acceptance: every control is wired to validated API functionality; no fake
  statistics or nonfunctional actions.

### 12. Reliability and optimization
- Complete focused unit/integration/E2E coverage, operational recovery,
  retention, cleanup, health checks, and documentation.
- Acceptance: restart and partial failure scenarios pass; storage deletion is
  previewed, confirmed, scoped, and recoverable; no credentials are exposed.

## Delivery approach

Complete and validate one milestone before starting the next. Keep this plan,
`ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `PROGRESS.md`, and `README.md` aligned
with actual implementation. External integrations are not described as working
until tested against the real configured service.
