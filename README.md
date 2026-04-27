# Campaign Brief Wizard (CBW)

Iterative AI co-author for campaign briefs. Drop in research, transcripts,
prior briefs and decks; chat with the strategist; watch a coherent brief
build itself in the right pane as the conversation goes.

**Live:** https://briefwizard.apps.aidigitallabs.com

## Build

Standard React 19 + Vite 6 + TypeScript stack on Netlify.

```bash
npm install
npm run dev      # local against staging Supabase per .env.local
npm run build    # production bundle
npm run lint
```

## Architecture

3-pane workspace:

| Pane | Component | Role |
|---|---|---|
| Left | `AssetRail` | Multi-file upload zone + asset list with extraction status |
| Center | `ChatPanel` (DS) | Dialogue with the strategist |
| Right | `BriefArtifact` | Live-updating campaign brief, section-by-section |

The orchestrator (`netlify/functions/orchestrator.mts`) streams two parallel
outputs per turn:
1. Chat text deltas via SSE `{ type: 'text_delta' }`
2. `patch_brief` tool calls converted to SSE `{ type: 'brief_patch' }`,
   shallow-merged into the live artifact

Per-upload extraction runs out-of-band in `ingest-asset-background.mts`
(strict `responseSchema` enforced; no content drift possible).

See `CLAUDE.md` for the full topology + parallel-thread TODO list.

## Mandatory rules

- **No content fallbacks.** If a brief field has no data, render nothing —
  never a placeholder string.
- **Background Lambdas need `-background` suffix.** 26s timeout otherwise.
- **All LLM calls via DS `createLLMProvider`** with `responseSchema` whenever
  the response is structured JSON.
- **3 hypotheses before any code decision.**

Full rule set lives in the master DS repo's `CLAUDE.md`.
