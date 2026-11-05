# Progress

## Project start

- Workspace inspected: empty; no existing code or dependencies.
- Runtime detected: Node.js 24, npm 11.
- Implementation plan and system boundaries documented.
- Next.js App Router, TypeScript, Tailwind CSS, Prisma, SQLite, Zod, and
  Lucide React are installed and configured.
- The overview shell uses live SQLite counts and recent executions; the
  application health endpoint checks the database.
- The normalized initial Prisma schema and SQLite migration are in place.

## Milestone 1: Project foundation

- Status: Complete.
- Validation passed: Prisma schema validation and migration, ESLint,
  TypeScript, production build, production server startup, dashboard HTTP 200,
  and `/api/health` reporting `status: ok` and `database: ok`.
- Known dependency advisory: `npm audit` reports a high-severity
  `deepmerge-ts` advisory through the Prisma 6 CLI. The automated fix requires
  a Prisma major upgrade; the CLI remains a development dependency, and the
  upgrade should be evaluated as part of dependency maintenance rather than
  applied without validating Prisma migration compatibility.

## Milestone 2: Excel integration

- Status: Complete.
- Implemented workbook preview/validation, idempotent schedule upsert, retained
  workbook metadata, schedule listing, and a safe worksheet export service.
- Validation passed: 12 focused tests (parser, worksheet export, isolated
  SQLite persistence/idempotency), ESLint, TypeScript, production build, and a
  live production-server upload/preview/import/re-import/dashboard check.
- A repeated workbook import updated one pending schedule rather than creating
  a duplicate; completed schedules are preserved.
- Remaining dependency advisories: current audit reports 3 high-severity
  findings through the Prisma 6 CLI and moderate findings in ExcelJS's
  transitive archive/UUID dependencies. No forced major dependency changes were
  applied; review before production deployment.
- The local dashboard binds to loopback and workbook endpoints reject
  cross-origin requests. User login is still required before any non-local
  deployment.

## Milestone 3: AI provider integration

- Status: Complete. The configured OmniRoute connection test succeeded.
- Added per-stage OpenAI-compatible provider settings, a shared-provider mode,
  server-side AES-256-GCM credential encryption, and an actual structured
  connection-test request with a JSON-mode compatibility fallback.
- Settings responses expose only whether a key exists; encryption-key status
  validates the configured value as exactly 32 bytes. Keep the key stable and
  backed up because replacing it makes existing credentials undecryptable.
- Validation passed: 23 tests, ESLint, TypeScript, and production build. AI
  tests cover encryption/tampering/key rotation, credential redaction,
  structured provider success, authentication errors, malformed and empty
  completions, timeout handling, usage metadata, and JSON-mode fallback.
- The API key was shared in chat and should be rotated; do not reuse or expose
  the old value. A successful connection test does not guarantee every model
  response will succeed.

## Milestone 4: Research engine

- Status: Complete.
- Added fixed-endpoint Bing RSS retrieval, bounded response size and timeout,
  URL canonicalization, deduplication, four targeted searches, and a 12-source
  cap. Search failures are reported, and a report is not synthesized with
  fewer than three usable sources.
- Added schema-validated AI synthesis, citation validation and persisted
  source-ID mapping, plus transactionally queued research sessions, explicit
  failure states, and history retrieval.
- Added `/research` with schedule selection, background status polling,
  cited findings and opportunities, and source links. Research is executed
  using Next.js `after()` in the web process until the dedicated worker is
  implemented in Milestone 9.
- Validation passed: 35 tests, ESLint, TypeScript, production build, local
  health endpoint, and browser rendering of `/research`. SQLite persistence
  tests cover successful citation mapping, duplicate active enqueue, retrieval
  failure, and missing AI configuration.
- A live research synthesis was later run against the imported Trending
  Cartoons schedule using the configured OmniRoute stage. Five sources and a
  complete cited report were persisted. The research model route was changed
  to `auto/best-fast` after the previous upstream model returned 404s.
- Snippets are evidence leads, not full article text. Validate claims against
  original pages before using the report as a production brief.
- Vitest now resolves the app's `@/` TypeScript alias and runs test files
  serially with timeouts appropriate for SQLite and filesystem integration
  tests.

## Milestone 5: Idea generation

- Status: Complete.
- Added schema-constrained idea generation from completed research, in batches
  of five, with the schedule's `Research_Ideas_Count` as the target.
- Ideas include a core concept, explanation, audience/need, search intent,
  keywords, rationale, visual direction, format, trend classification, and
  destination relevance. Every idea cites retrieved source IDs.
- Added normalized title hashing and duplicate suppression, transactional
  persistence, retryable execution states, background status polling, and
  stale-run recovery after eight minutes without progress.
- Added the `/ideas` workspace and navigation entry. It displays saved ideas,
  status, and links to the evidence behind each idea.
- Improved structured AI output recovery: fenced JSON is accepted, and
  malformed or schema-invalid output receives actionable correction feedback
  on retry.
- Validation passed: 43 tests, ESLint, TypeScript, production build, and a live
  generation run for the saved schedule. All three requested ideas were saved
  with source citations and returned from the workspace API.
- The idea-generation AI stage is configured to OmniRoute `auto/best-chat`
  with a 120-second request timeout after `auto/fast` repeatedly routed to
  unavailable upstream models. This setting is local to the configured stage.

## Milestone 6: Idea scoring

- Status: Complete.
- Added seven-dimension 1–10 scoring with application-calculated weighted
  scores, exact idea/score coverage validation, deterministic ranking, and
  bounded AI batches.
- Added diverse pin selection that favors new content formats, search
  intents, and trend classifications while honoring `Pins_To_Generate`.
- Scores, assessment details, and selected/rejected ranks are persisted
  transactionally. Failed and stale scoring runs can be retried.
- Extended `/ideas` with a score-and-select action, status polling, score
  dimensions, selection ranking, evaluator reasoning, and improvement notes.
- Validation passed: 52 tests, including SQLite persistence/idempotency and
  score/selection coverage; ESLint; TypeScript; and production build.
- Model assessments are advisory and do not represent measured click-through,
  search volume, or pin performance.
- The `auto/best-chat` evaluator alias intermittently routed to targets that
  returned 404/503/504 responses, including pre-dispatch filtering and queue
  expiration. The evaluation stage was changed to OmniRoute `auto/best-free`
  with a 2,048-token output limit and 180-second timeout.
- A live scoring run then completed successfully: all three ideas received
  persisted scores and all three requested pins were selected. The `/api/ideas`
  workspace returned `Scored` with all score and selection records present.
- The OmniRoute adapter also retries Felo thread-creation HTTP 400 responses
  without native JSON mode and reports any remaining Felo failure as an
  upstream route compatibility issue, not an API-key rejection. Provider
  aliases can still be intermittent, so retry scoring if the relay reports
  temporary dispatch or capacity errors.

## Milestone 7: Pinterest content generation

- Status: Complete.
- Added selected-only, bounded-batch generation of Pinterest titles,
  descriptions, hashtags, search keywords, and vertical-pin image prompts.
- Provider output is normalized and validated for exact selected-idea
  coverage before a transaction persists it with the schedule's destination
  URL. Completed packages are preserved across retries; invalid or failed
  output is explicitly marked failed and is not saved as complete.
- Added the content-generation API, retryable execution lifecycle, stale-run
  recovery, progress polling, error display, and package display in `/ideas`.
- Validation passed: the full suite (56 tests across 12 files), ESLint,
  TypeScript, and production build. A live run completed with all three
  selected ideas saved as complete packages; `/api/ideas` returned HTTP 200
  with three scored ideas, three selected ideas, and three complete packages.
- The live content-generation run used the configured `content_generation`
  route. Provider availability remains dependent on the configured upstream;
  test the actual task and retry if it is temporarily unavailable.

## Milestone 8: Hugging Face Inference image generation

- Added a server-side Hugging Face Inference Providers adapter for text-to-image
  requests, including bounded retries, raw image response handling, and
  redacted provider errors.
- Added Hugging Face model ID, timeout, and retry settings; the access token
  uses the existing encrypted credential storage. Existing Cloudflare image
  credentials require replacement with a Hugging Face token.
- Added a settings test that generates a real image and validates its raster
  dimensions, plus automatic per-idea and sequential batch generation.
- Generated assets continue through the existing validation, WebP
  normalization, and local persistence path; manual upload remains available.
- Local adapter tests use mocked responses. Live API verification is pending
  user-entered Hugging Face credentials, credits, and model/provider access.

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| 1. Project foundation | Complete | App shell, Prisma/SQLite, initial migration, health check, and acceptance checks passed. |
| 2. Excel integration | Complete | Workbook preview/import, persistent idempotent schedules, and safe worksheet export. |
| 3. AI provider integration | Complete | Encrypted stage settings and successful OmniRoute connection test; rotate the key shared in chat. |
| 4. Research engine | Complete | Bing RSS retrieval, persisted cited reports, and research workspace. |
| 5. Idea generation | Complete | Structured, deduplicated, cited ideas and `/ideas` workspace. |
| 6. Idea scoring | Complete | Seven weighted dimensions, diversity-aware selection, and persisted selected/rejected ranks. |
| 7. Content generation | Complete | Selected-only validated packages, retry-safe persistence, and live run verified. |
| 8. Hugging Face image workflow | Implemented; live test pending | Hugging Face settings, real-image test endpoint, and automatic generation are wired. |
| 9. Worker and scheduler | Not started | |
| 10. Excel output automation | Not started | |
| 11. Complete dashboard | Not started | |
| 12. Reliability and optimization | Not started | |

## External integration prerequisites

- Testing the AI connection against a real provider requires a user-configured
  compatible endpoint, model, and API key.
- Hugging Face image generation requires an Inference Providers token, provider
  access to the selected model, and available credits; billing and terms are
  controlled by Hugging Face and its inference partners.
- Research retrieval currently uses public Bing RSS; a durable worker remains
  planned for Milestone 9.
