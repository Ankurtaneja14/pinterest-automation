# Database Schema

SQLite is the initial relational store and Prisma is the ORM. This document
describes the intended normalized model; concrete Prisma models and migrations
are introduced incrementally with their owning milestones.

## Entities

| Entity | Purpose | Important relations / constraints |
|---|---|---|
| `NicheSchedule` | Imported execution configuration | Unique stable schedule key; indexed execution date and status |
| `WorkbookUpload` | Original uploaded workbook metadata | Unique relative path; content hash, byte size, imported row count |
| `ExecutionJob` | Durable execution state and checkpoints | Belongs to a schedule; unique execution intent; indexed status, due date, and lease |
| `ResearchSession` | One report per execution/research attempt | Belongs to execution; report JSON and file reference |
| `ResearchSource` | Retrieved evidence | Belongs to research session; deduplicated canonical URL |
| `ContentIdea` | Generated idea, including unselected | Belongs to execution; unique per execution/provider idea key |
| `IdeaScore` | Criterion scores and rationale | One-to-one with idea; validated 1–10 criteria; computed score |
| `SelectedIdea` | Diversity-aware rank/selection record | Unique idea and selection rank per execution |
| `ContentPackage` | Pinterest text and image prompt | Belongs to selected idea; unique package per idea |
| `GeneratedAsset` | Image metadata and validation result | Belongs to package and execution; tracks queued/generating/failed/complete state, safe relative path, dimensions, format, size, and hash |
| `AIConfiguration` | Provider/model config and encrypted key | Stage/provider configuration; encrypted secret only |
| `ExecutionLog` | Searchable stage/event history | Belongs to execution; indexed timestamp, stage, and severity |
| `StorageRecord` | Execution-owned files and cleanup metadata | Unique relative path; category, size, hash, and deletion state |

## Relationships

```text
NicheSchedule 1 --- n ExecutionJob
ExecutionJob  1 --- 0..1 ResearchSession 1 --- n ResearchSource
ExecutionJob  1 --- n ContentIdea 1 --- 0..1 IdeaScore
ContentIdea   1 --- 0..1 SelectedIdea 1 --- 0..1 ContentPackage 1 --- n GeneratedAsset
ExecutionJob  1 --- n ExecutionLog
ExecutionJob  1 --- n StorageRecord
```

## Data integrity and indexes

- Use generated IDs and explicit foreign keys with intentional deletion policy.
- Index schedule execution date/status and job status/lease timestamps.
- Index execution IDs and niche names; enforce uniqueness for idempotent imports,
  output rows, ranks, and asset locations.
- Persist stage outputs before marking a stage complete.
- Store image binaries outside SQLite; retain metadata and relative paths in the
  database.
- Hugging Face-generated and user-uploaded raster images are normalized to WebP
  before being marked complete. `GeneratedAsset.status` and source/validation
  details are persisted in SQLite. AI provider credentials use the application
  encryption key. The nullable `AIConfiguration.accountId` column is retained
  for compatibility with existing databases and is cleared for Hugging Face
  image-generation settings.
- Track original uploaded workbook paths, hashes, sizes, and row counts in
  `WorkbookUpload`; schedule rows retain their current source path.
- Never store plaintext provider API keys. AI keys are encrypted with
  AES-256-GCM; the 32-byte encryption key is configuration-only and must be
  backed up because replacing it prevents decryption of existing credentials.
- Cleanup is execution-scoped and first marked as pending; never delete data
  owned by an active execution.

## Migration strategy

Prisma schema and migration files are the executable source of truth. This
document is updated alongside schema changes. Migrations must be additive and
tested against a fresh SQLite database before runtime use.
