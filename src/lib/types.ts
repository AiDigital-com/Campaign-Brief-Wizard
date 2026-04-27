/**
 * Domain types for Campaign Brief Wizard.
 *
 * Schema mirrors AI Digital's standard 13-section media brief.
 * Every field is optional — orchestrator + ingest fill them in over time.
 * Empty = "not yet known". UI must NEVER render placeholder copy
 * (see CLAUDE.md "No content fallbacks").
 */

// ── Section keys (drive the Updated overlay + change-set diff) ───────────
export const BRIEF_SECTION_KEYS = [
  'submission',
  'background',
  'goals',
  'kpis',
  'audience',
  'competitors',
  'geos',
  'budget',
  'channels',
  'creative',
  'measurement',
  'deliverables',
  'openQuestions',
] as const;
export type BriefSectionKey = typeof BRIEF_SECTION_KEYS[number];

// ── Section-level shapes ─────────────────────────────────────────────────

export interface BriefSubmission {
  client?: string;
  vertical?: string;
  clientPOC?: string;
  aidPOC?: string;
  clientType?: string;
  dueDate?: string;
  priority?: string;
}

export interface BriefGoals {
  awarenessObjective?: string;
  awarenessMeasure?: string;
  conversionObjective?: string;
  conversionMeasure?: string;
}

export interface BriefKpi {
  label: string;
  base?: string;
  target: string;
}

export interface BriefPersona {
  name: string;
  age?: string | number;
  role?: string;
  quote?: string;
  initial?: string;
}

export interface BriefAudience {
  primary?: string;
  personas?: BriefPersona[];
}

export interface BriefGeo {
  city: string;
  market?: string;
  primary?: boolean;
}

export interface BriefBudgetLine {
  label: string;
  amount: number;
}

export interface BriefFlightPhase {
  name: string;
  startPct: number;
  widthPct: number;
  tone?: 'sample' | 'burst' | 'sustain';
}

export interface BriefBudget {
  lines?: BriefBudgetLine[];
  flightStart?: string;
  flightEnd?: string;
  phases?: BriefFlightPhase[];
}

export interface BriefChannelLine {
  code: string;
  name: string;
  amount: number;
}

export interface BriefTactic {
  code?: string;
  name: string;
  note?: string;
}

export interface BriefChannels {
  lines?: BriefChannelLine[];
  successTactics?: BriefTactic[];
  failedTactics?: BriefTactic[];
}

export interface BriefCreative {
  materials?: string;
  production?: string;
  commsPlatform?: string;
  rtb?: string;
  brandLine?: string;
}

export interface BriefMeasurement {
  benchmarks?: string;
  conversionAction?: string;
  reportingCadence?: string;
  accountOwnership?: string;
  inHouse?: string;
  dashboarding?: string;
}

export interface BriefDeliverable {
  kind: string;
  eta?: string;
  note?: string;
}

// ── Top-level Brief ──────────────────────────────────────────────────────

export interface Brief {
  // Document meta (renders in the artifact header subline)
  title?: string;
  agency?: string;
  client?: string;
  industry?: string;
  status?: string;

  // 13 sections
  submission?: BriefSubmission;       // 01
  background?: string;                // 02
  goals?: BriefGoals;                 // 03
  kpis?: BriefKpi[];                  // 04
  audience?: BriefAudience;           // 05
  competitors?: string[];             // 06
  geos?: BriefGeo[];                  // 07
  budget?: BriefBudget;               // 08
  channels?: BriefChannels;           // 09
  creative?: BriefCreative;           // 10
  measurement?: BriefMeasurement;     // 11
  deliverables?: BriefDeliverable[];  // 12
  openQuestions?: string[];           // 13

  // Provenance: asset id -> brief field paths the asset contributed to
  sources?: Record<string, string[]>;
  lastUpdatedAt?: string;
}

// ── Patch event (streamed from orchestrator over SSE) ────────────────────

export interface BriefPatch {
  /** Partial Brief — server-side handler does 1-level deep merge:
   *  for each top-level section key, if both sides are objects, shallow
   *  merge field-by-field; otherwise replace. Arrays always replace. */
  patch: Partial<Brief>;
  /** Optional 1-2 sentence rationale the UI shows in the update banner. */
  rationale?: string;
}

// ── Assets ────────────────────────────────────────────────────────────────
//
// CBW asset rows live in the canonical `assets` table (created by the DS
// upload handler). `AssetState` is the client-side projection used by
// useAssetUpload — mirrors the SFG shape with CBW-specific extraction state
// folded in via `ingestStatus` + `briefSkeleton`.

export type AssetIngestStatus = 'pending' | 'extracting' | 'extracted' | 'error';

export interface AssetState {
  /** Stable client id (crypto.randomUUID) — React key + remove handle. */
  id: string;
  /** ID of the canonical `assets` row. Set once /upload-asset returns. */
  assetId?: string;
  fileName?: string;
  mimeType?: string;
  /** Local blob: URL for image preview. Only set for image MIME types. */
  previewUrl?: string | null;
  /** Public Supabase storage URL — populated by the DS upload handler. */
  supabaseAssetUrl?: string;
  /** Free-text label the orchestrator can use when referring to the asset. */
  label?: string;
  /** True while the upload-asset POST is in flight. */
  uploading?: boolean;
  /** Upload error string (mutually exclusive with `uploading`). */
  error?: string | null;
  /** Server-side ingest pipeline state, mirrored from assets.meta.ingest_status. */
  ingestStatus?: AssetIngestStatus;
  /** assets.meta.brief_skeleton — populated when ingestStatus='extracted'. */
  briefSkeleton?: Record<string, unknown>;
  ingestError?: string | null;
}

// ── Chat ──────────────────────────────────────────────────────────────────

export type ChatKind = 'message' | 'update' | 'question' | 'typing';

export interface ChatAssetRef {
  assetId: string;
  name: string;
  /** MIME type or coarse kind label (e.g. 'pdf', 'docx', 'image'). */
  kind?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** Defaults to 'message' when omitted. */
  kind?: ChatKind;
  content: string;

  // ── 'update' kind: brief-mutated banner ────────────────────────
  changedSections?: BriefSectionKey[];
  versionNumber?: number;

  // ── 'question' kind: bot question card with options ────────────
  /** Pill label, e.g. "Question 3 / 6". */
  pill?: string;
  /** 2-4 quick-reply options; clicking auto-sends the answer. */
  options?: string[];

  // ── References ─────────────────────────────────────────────────
  assetRefs?: ChatAssetRef[];
  meta?: Record<string, unknown>;
}

// ── Version row (mirrors cbw_brief_versions) ─────────────────────────────

export interface BriefVersion {
  id: string;
  sessionId: string;
  versionNumber: number;
  briefData: Brief;
  patch: Partial<Brief> | null;
  changedSections: BriefSectionKey[];
  triggerMessageId: string | null;
  triggerKind: 'chat' | 'ingest' | 'manual_edit' | null;
  rationale: string | null;
  createdAt: string;
}
