# Pinterest Autonomous Content Engine

A single-user application for importing a niche schedule, producing
research-backed Pinterest content, generating images, and exporting results
back to Excel. It is being implemented milestone by milestone; see
[`PROJECT_PLAN.md`](./PROJECT_PLAN.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md),
[`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), and [`PROGRESS.md`](./PROGRESS.md).

## Requirements

- Node.js 20.9 or later
- npm

## Development setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`. Generate a unique encryption key in
   PowerShell with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Put the output in `APP_ENCRYPTION_KEY`. Keep it private and backed up:
   replacing it makes previously stored provider credentials undecryptable.
3. Run the initial database migration with
   `npm run db:migrate -- --name init`.
4. Start the dashboard with `npm run dev` (opens at
   `http://127.0.0.1:4000` and binds to loopback).

The dashboard health endpoint is available at `/api/health`. The research
workspace retrieves public Bing RSS snippets and uses the configured research
AI stage to create a cited brief. The Ideas workspace turns a completed brief
into the number of source-cited ideas specified by `Research_Ideas_Count` in
the schedule, prevents duplicate titles, and scores the ideas to select a
diverse subset for the schedule's requested pin count. It then generates
validated Pinterest content packages for selected ideas, including titles,
descriptions, hashtags, search keywords, and vertical-pin image prompts.
The Images workspace generates selected-idea pin images through Hugging Face
Inference. Configure an Inference Providers token and text-to-image model
under `/settings/ai`, use **Test Hugging Face image API** to make a real
generation request, then generate images individually or in sequence.
Generated images are validated, normalized to WebP, and stored locally.
Manual image upload remains available as a fallback.

## AI provider configuration

Open `/settings/ai` to configure an OpenAI-compatible chat-completions endpoint
and model for each AI stage, or share one configuration across stages. Save
credentials before using **Test connection**; the test makes a real provider
request and validates the model's structured response. API keys are encrypted
in SQLite and are never returned by the settings API. The connection test
validates a structured model response, retries transient failures according to
the configured retry limit, and falls back to prompt-only JSON when the
provider's JSON mode is unsupported or returns an unusable completion. No
external provider has been verified until tested with the user's own endpoint
and credentials. If a router rejects every target during pre-dispatch for
native JSON mode, or a Felo route rejects thread creation with HTTP 400,
requests are retried without the native JSON parameter.

Configure image generation separately in `/settings/ai`: choose a model
supported by Hugging Face's `hf-inference` provider and enter a fine-grained
access token with Inference Providers permission. The default is
`stabilityai/stable-diffusion-3-medium-diffusers`; Hugging Face also documents
models such as `Qwen/Qwen-Image` and `ByteDance/Hyper-SD`, but availability
through a specific provider can vary. Requests use the Hugging Face Inference
Providers router and request portrait dimensions for Pinterest. The token is
encrypted using `APP_ENCRYPTION_KEY`; it is not returned by the settings API.
**Test Hugging Face image API** generates and validates a real image. Hugging
Face Free accounts have no included Inference Providers credits or daily
credit reset, so waiting until tomorrow or changing models will not resolve
HTTP 402. Purchase credits or use an eligible plan with included credits;
confirm current [pricing and billing](https://huggingface.co/docs/inference-providers/pricing)
and model availability before testing. For no-cloud-cost image generation,
generate locally with your own compatible hardware and upload the result; this
app does not currently invoke a local image model.

## Excel schedules

Upload an `.xlsx` file (10 MB maximum) containing a worksheet named
`Niche_Schedule`. The first row contains these required columns:

`Niche`, `Execution_Date`, `Target_Country`, `Target_Audience`, `Language`,
`Research_Ideas_Count`, `Pins_To_Generate`, and `Destination_URL`.

`Status` is optional and defaults to `Pending`. Dates may be Excel date cells or
`YYYY-MM-DD`; counts must be positive whole numbers; destination links must use
HTTP or HTTPS. The dashboard previews valid rows and row-specific errors before
import. Imports with validation errors are rejected rather than partially
applied. Re-uploading an existing schedule updates it only while it is still
pending; active or completed schedules are preserved. Original workbooks are
retained under the configured storage directory and tracked in SQLite.

The Excel export service appends a uniquely named, sanitized niche/date
worksheet to a separate output workbook, preserves existing worksheets, and
writes through a temporary file before replacement. The execution pipeline
will invoke this service when generated content becomes available.

## Security and data

Secrets must remain server-side. Runtime uploads, generated images, reports,
and logs belong in local storage and must not be committed.
Excel is an import/export interface; SQLite is the system of record.
This initial single-user build binds to loopback and checks browser request
origins on state-changing endpoints. It does not yet include user login; do not
expose it to a LAN, reverse proxy, or public network. Keep a backup of
`APP_ENCRYPTION_KEY`; changing it requires re-entering saved provider keys.
Hugging Face credentials are sent only to Hugging Face's Inference Providers
router from the server. Generated and uploaded raster images are validated,
normalized to WebP, and stored under `STORAGE_ROOT`.

## Current status

Milestones 1–7 (project foundation, Excel integration, AI provider
configuration, research, idea generation, idea scoring, and Pinterest content
generation) are implemented. Hugging Face Inference image generation is wired
through settings, an image API test, and automatic selected-image generation;
a live account request still requires credentials configured by the user.
Scoring
combines seven weighted dimensions with diversity-aware selection; the model's
assessments are guidance, not verified performance predictions. Milestone 8
uses Hugging Face Inference Providers, subject to model availability, billing,
and provider terms.
Research retrieves and stores deduplicated source snippets; each research
claim and generated idea cites saved source evidence. Search snippets are
leads rather than complete articles; verify details at the linked source. AI
generation requires a configured, working provider and model.
Automated scoring, content persistence, image validation, and image persistence
are covered by local unit and SQLite integration tests. Hugging Face image
generation is tested with mocked API responses locally; verify the live API
from AI settings after entering your credentials.
Provider routes can still be capacity- or filter-dependent; use **Test
connection** and retry if the relay is temporarily unavailable.
Implementation and validation status is tracked in [`PROGRESS.md`](./PROGRESS.md).
