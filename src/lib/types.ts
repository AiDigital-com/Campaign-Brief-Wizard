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

export type AssetKind =
  | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'csv'
  | 'image' | 'url' | 'md' | 'txt' | 'other';

export interface BriefAsset {
  id: string;
  name: string;
  kind: AssetKind;
  /** Bytes. Absent for URL assets. */
  size?: number;
  /** Pre-formatted page/slide/sheet count for the asset card chip
   *  ("14 pages" / "38 slides" / "live page"). */
  pagesLabel?: string;
  /** Public Supabase storage URL once uploaded. */
  url?: string;
  /** Internal storage path (bucket-relative). Always set after upload. */
  storagePath?: string;
  /** Thumbnail URL if available (PDF first page, image preview). */
  thumbnailUrl?: string;
  /** UI state machine. */
  state: 'pending' | 'uploading' | 'extracting' | 'ready' | 'error';
  /** 0-100, populated during 'uploading' and 'extracting'. */
  progress?: number;
  /** Set once ingest completes — populated by orchestrator from
   *  brief_skeleton extraction. */
  hits?: string;          // e.g. "11 passages mapped"
  maps?: string[];        // ["§ Goals", "§ Budget"] — section pills
  tags?: string[];        // primary tags
  minor?: string;         // secondary tag
  quote?: string;         // pull quote shown in Sources tab
  ingestError?: string;
  addedAt: string;
}

// ── Chat ──────────────────────────────────────────────────────────────────

export type ChatKind = 'message' | 'update' | 'question' | 'typing';

export interface ChatAssetRef {
  assetId: string;
  name: string;
  kind: AssetKind;
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
