/**
 * Domain types for Campaign Brief Wizard.
 *
 * `Brief` is the live artifact that gets patched as the user converses.
 * Treat every field as optional — the orchestrator fills them in over time
 * and the UI must conditionally render (NEVER fall back to placeholder copy
 * — see /CLAUDE.md "No content fallbacks").
 */

export interface BriefAsset {
  /** Stable ID. Generate client-side, then sync with `cbw_assets.id`. */
  id: string;
  /** Original filename. */
  name: string;
  /** MIME type or our coarse type tag (`pdf` / `docx` / `image` / `transcript` / `other`). */
  type: string;
  /** Bytes — use to render a "1.2 MB" label. */
  size: number;
  /** Public Supabase storage URL once uploaded. Empty during local-only state. */
  url?: string;
  /** Thumbnail URL when the type supports it (image, PDF first page). */
  thumbnailUrl?: string;
  /** ISO timestamp the user added this asset. */
  addedAt: string;
  /** Server-side extraction status — purely advisory for the UI. */
  ingestStatus?: 'pending' | 'extracting' | 'extracted' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Optional structured payload attached to assistant messages
   *  (e.g. `{ kind: 'brief_patch', patch: {...} }` for inline UI hints). */
  meta?: Record<string, unknown>;
}

/**
 * The campaign brief artifact.
 *
 * Sections are deliberately granular — orchestrator can fill them
 * incrementally as it gathers info from uploads + dialogue. Empty fields
 * = "not yet known", NOT "use a placeholder string".
 */
export interface Brief {
  /** Plain-English summary the artifact panel uses as the H1. */
  title?: string;

  // ── Strategic frame ───────────────────────────────────────────────
  /** Who the campaign is for (1-2 sentences). */
  audience?: string;
  /** Marketing problem / business objective. */
  objective?: string;
  /** Single most important takeaway the audience should leave with. */
  singleMindedProposition?: string;
  /** What the audience currently believes / does. */
  currentMindset?: string;
  /** What we want them to believe / do after the campaign. */
  desiredMindset?: string;

  // ── Brand & tone ─────────────────────────────────────────────────
  brand?: {
    name?: string;
    archetype?: string;
    toneOfVoice?: string;
    personality?: string[];
    competitiveContext?: string;
  };

  // ── Deliverables & channels ──────────────────────────────────────
  channels?: string[];
  deliverables?: Array<{ id: string; format: string; specs?: string; notes?: string }>;
  timing?: { kickoffDate?: string; launchDate?: string; milestones?: string[] };
  budget?: { amount?: number; currency?: string; notes?: string };

  // ── Constraints & must-haves ─────────────────────────────────────
  mandatories?: string[];
  doNots?: string[];
  legalNotes?: string;

  // ── Open questions the orchestrator still needs answered ─────────
  openQuestions?: string[];

  // ── Source provenance ────────────────────────────────────────────
  /** asset IDs (BriefAsset.id) → list of brief field paths the asset
   *  contributed to. Lets the UI show "this section came from
   *  creative-brief.docx" annotations. */
  sources?: Record<string, string[]>;

  /** ISO timestamp the artifact was last patched. */
  lastUpdatedAt?: string;
}

/** Brief patch event streamed from orchestrator over SSE. */
export interface BriefPatch {
  /** Shallow merge into top-level Brief fields. */
  patch: Partial<Brief>;
  /** Optional reasoning the UI can show as a subtle annotation. */
  rationale?: string;
}
