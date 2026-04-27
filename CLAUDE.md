# Campaign Brief Wizard (CBW)

> Iterative campaign-brief co-author. Multi-doc ingest + dialogue → live
> brief artifact that updates as the user converses. Different topology
> from other AI Digital tools (no batch pipeline — single orchestrator
> owns the artifact, patches it incrementally).

## App Info

| Field | Value |
|-------|-------|
| App | Campaign Brief Wizard |
| Abbrev | CBW |
| URL | https://briefwizard.apps.aidigitallabs.com |
| Repo | `AiDigital-com/Campaign-Brief-Wizard` |
| Netlify Site ID | `70a49e6b-82a9-4922-8961-36cc36bd3160` |
| Supabase tables | `cbw_sessions`, `cbw_assets` |
| Storage bucket | `cbw-assets` |
| Tool slug | `campaign-brief-wizard` |

## Topology — different from the rest of the portfolio

Other AI Digital tools follow a batch pipeline:
```
intake → run_audit → engines → synthesize → review → final report
```

CBW follows the iterative-artifact pattern:
```
intake (ongoing) → orchestrator (chat) → patches Brief artifact
                ↓
         ingest-asset-background (per upload, parallel)
```

The `Brief` (`src/lib/types.ts:Brief`) is the live deliverable. Every
orchestrator turn:
- streams text deltas to the chat panel
- emits one or more `patch_brief` tool calls → SSE `{ type: 'brief_patch' }`
- frontend shallow-merges the patch into the live artifact
- session persistence merges `brief_data` into `cbw_sessions`

Each uploaded asset triggers `ingest-asset-background` which extracts text
and emits a first-pass skeleton stored on `cbw_assets.brief_skeleton`. The
orchestrator reads these skeletons on subsequent turns to ground its patches.

## File map

```
src/
  App.tsx                        — AppShell + sidebar + AppContent
  components/
    Workspace.tsx                — 3-pane shell (assets · chat · brief)
    AssetRail.tsx                — left pane, multi-file UploadZone wrapper
    BriefArtifact.tsx            — right pane, conditionally-rendered brief
  lib/
    types.ts                     — Brief / BriefAsset / ChatMessage / BriefPatch
  pages/
    HelpPage.tsx                 — public /help (template default)
netlify/
  functions/
    orchestrator.mts             — SSE chat + patch_brief tool
    ingest-asset-background.mts  — per-asset extraction + skeleton (responseSchema)
    dispatch-handler.mts         — UNUSED for CBW (kept from template; safe to delete)
    task-worker.mts              — UNUSED for CBW (kept from template; safe to delete)
    run-audit-background.mts     — UNUSED for CBW (template stub)
```

CBW does NOT use the `pipeline_tasks` queue. The template provides
`dispatch-handler.mts` + `task-worker.mts` for apps that DO need batch
pipelines (NM/WA/SFG/CCR/AIO). They're left in the tree for reference
but not wired in.

## Mandatory rules — see `/CLAUDE.md` (template) and DS CLAUDE.md

The DS repo's CLAUDE.md is the source of truth for portfolio-wide rules:
- No content fallbacks (this app must NEVER show placeholder verdict prose)
- Background Lambda naming (`-background` suffix)
- Schema enforcement (responseSchema + strict destructure)
- 3 hypotheses before any code decision
- All LLM calls via `createLLMProvider`

Read both before working in this repo.

## Parallel-thread TODO

The user is implementing the orchestrator wiring + asset upload flow in a
parallel session. Stubs marked `TODO (parallel thread)` in:
- `src/App.tsx:handleSend` — SSE stream parsing + brief_patch merge
- `src/App.tsx:handleAssetsChange` — trigger ingest-asset-background
- `src/components/AssetRail.tsx:handleFiles` — Supabase storage upload
- `netlify/functions/orchestrator.mts` — context plumbing for asset
  skeletons (read `cbw_assets.brief_skeleton` for current session and
  pass into the system prompt)

Don't accidentally re-implement these — coordinate with the parallel thread.

## Environment

All shared env vars are at Netlify team level (`aidigital-operating-llc`).
CBW inherits them automatically: `NPM_TOKEN`, `VITE_CLERK_*`, `CLERK_*`,
`GEMINI_API_KEY`, `VITE_SUPABASE_*`, `SUPABASE_*`.

No site-level overrides expected.
