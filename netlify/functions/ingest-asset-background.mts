/**
 * ingest-asset-background — extract usable text from an uploaded asset
 * and emit a first-pass brief skeleton from it.
 *
 * Triggered by the AssetRail upload flow:
 *   POST /.netlify/functions/ingest-asset-background { assetId }
 *
 * Reads from the canonical `assets` table (created by upload-asset via the
 * DS createUploadAssetHandler). On success, writes back:
 *   - assets.extracted_text   ← full text with section markers
 *   - assets.meta             ← shallow-merged with { brief_skeleton, ingest_status, ingest_error }
 *
 * Why -background: PDF/DOCX text extraction + a Gemini Pro analysis pass
 * can comfortably exceed Netlify's 26s streaming-mode timeout on large
 * decks. -background suffix flips this to 15-min budget.
 */
import { createLLMProvider, repairJson } from '@AiDigital-com/design-system/server';
import { extractDocumentText } from '@AiDigital-com/design-system/document';
import { createClient } from '@supabase/supabase-js';
import { log } from './_shared/logger.js';
import { requireAuthOrEmbed } from './_shared/auth.js';
import { BRIEF_JSON_SCHEMA } from './_shared/brief.js';

const APP_NAME = 'campaign-brief-wizard';

const EXTRACTION_PROMPT = `You are reading ONE source document and extracting a
complete partial brief for AI Digital's 13-section campaign media brief format.

# ABSOLUTE RULES

1. **Always return EVERY top-level key.** The schema has 5 meta keys + 13
   section keys (18 total). Every one MUST appear in your output. If the
   document has no evidence for a section, return its empty form:
     - object section ({}) → empty object \`{}\`
     - array section ([])  → empty array \`[]\`
     - string section      → empty string \`""\`
   Never omit a key. An absent key means "we forgot to look"; an empty
   value means "we looked, found nothing".

2. **Never invent.** If a fact isn't explicitly in the document, it goes
   in the empty bucket. Do not infer, paraphrase loosely, or fill from
   "common practice". The strategist will ask the user follow-up questions
   to fill gaps; your job is to extract, not to imagine.

3. **Be aggressive about explicit evidence.** RFPs / decks / recap docs
   contain far more structured detail than they look. If a deck has a
   "Goals" slide, fill goals.awarenessObjective and goals.conversionObjective
   from that slide. If an RFP lists \`Q4 2026 Launch\`, that's
   submission.dueDate. Read the WHOLE document before deciding a section
   is empty.

# REQUIRED OUTPUT SHAPE

Return exactly this object — every key present, no extras:

\`\`\`json
{
  "title":     "",
  "agency":    "",
  "client":    "",
  "industry":  "",
  "status":    "",
  "submission":  { "client":"", "vertical":"", "clientPOC":"", "aidPOC":"", "clientType":"", "dueDate":"", "priority":"" },
  "background":  "",
  "goals":       { "awarenessObjective":"", "awarenessMeasure":"", "conversionObjective":"", "conversionMeasure":"" },
  "kpis":        [],
  "audience":    { "primary":"", "personas":[] },
  "competitors": [],
  "geos":        [],
  "budget":      { "lines":[], "flightStart":"", "flightEnd":"", "phases":[] },
  "channels":    { "lines":[], "successTactics":[], "failedTactics":[] },
  "creative":    { "materials":"", "production":"", "commsPlatform":"", "rtb":"", "brandLine":"" },
  "measurement": { "benchmarks":"", "conversionAction":"", "reportingCadence":"", "accountOwnership":"", "inHouse":"", "dashboarding":"" },
  "deliverables":  [],
  "openQuestions": []
}
\`\`\`

# WHAT GOES WHERE

- **title / agency / client / industry / status** — top-line meta. Fill from
  the cover page or first paragraph.
- **submission** — RFP intake fields. clientPOC and aidPOC are emails or
  names with role. dueDate is the proposal-due or campaign-due date in
  ISO form (YYYY-MM-DD) when possible.
- **background** — narrative paragraph on the business + market context.
- **goals** — Awareness vs Conversion. awareness*Measure is HOW we'll
  measure (e.g. "reach + frequency · brand-lift Q2"); the *Objective is
  WHAT we want (e.g. "spark emotion, normalize the Lottery").
- **kpis** — array of \`{ "label":"<KPI name>", "base":"<current>", "target":"<goal>" }\`.
  If only the target is stated, leave base empty. Both label and target are
  required for an entry to be included.
- **audience** — primary is a 1-2 sentence summary. personas is an array of
  \`{ "name", "age", "role", "quote", "initial" }\` — only fill personas
  that are explicitly described in the doc.
- **competitors** — array of competitor names or short descriptors.
- **geos** — array of \`{ "city", "market", "primary":boolean }\`.
- **budget.lines** — \`[{ "label", "amount":<number, USD> }, ...]\`. amount
  is a plain integer (no commas, no $).
- **budget.phases** — \`[{ "name", "startPct":0-100, "widthPct":0-100, "tone":"sample"|"burst"|"sustain" }]\`.
  Only include if the doc explicitly describes flight phases.
- **channels.lines** — \`[{ "code":"<short>", "name":"<full>", "amount":<USD int> }]\`.
- **channels.successTactics** / **failedTactics** — \`[{ "code":"<short>", "name":"<tactic>", "note":"<short detail>" }]\`.
- **creative** — text fields, fill what the doc says. brandLine is the
  campaign tagline / slogan if quoted.
- **measurement** — text fields about how the campaign will be measured,
  reported, and owned.
- **deliverables** — \`[{ "kind":"<type>", "eta":"<date or label>", "note":"<short>" }]\`.
- **openQuestions** — array of strings, one per gap. Phrase each as a
  question the user can answer in one sentence. Add an entry every time
  you encounter a section the document partially-but-incompletely covers.

# DOCUMENT TYPE HEURISTICS (just hints, not gates)

- **RFP / new-business brief**: dense in submission, background, goals,
  geos, budget, deliverables, dueDate.
- **Audience / persona deck**: dense in audience.primary, audience.personas,
  sometimes competitors.
- **Recap / benchmark deck**: dense in kpis, channels (with success and
  failed tactics in different sections), measurement.
- **Brand guidelines**: dense in creative.brandLine, creative.materials,
  creative.rtb.
- **Email thread / call transcript**: dense in background, openQuestions,
  scattered constraints — scan for "must / can't / required / exclude".

Read the entire document first. Then build the output object once. Return
it as raw JSON matching the schema exactly.`;

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let userId: string;
  try {
    const auth = await requireAuthOrEmbed(req);
    userId = auth.userId;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { assetId } = body as { assetId?: string };
  if (!assetId) {
    return Response.json({ error: 'Missing assetId' }, { status: 400 });
  }

  const startTime = Date.now();
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  log.info('ingest-asset-background.start', {
    function_name: 'ingest-asset-background',
    entity_id: assetId,
    user_id: userId,
  });

  try {
    // 1. Load canonical assets row
    const { data: asset, error: loadErr } = await supabase
      .from('assets')
      .select('id, source_uri, source_filename, source_mime_type, user_id, meta')
      .eq('id', assetId)
      .maybeSingle();
    if (loadErr || !asset) throw new Error(`Asset ${assetId} not found`);
    if (asset.user_id !== userId) throw new Error('Forbidden');

    // Mark in-flight
    await supabase
      .from('assets')
      .update({ meta: { ...(asset.meta || {}), ingest_status: 'extracting', ingest_error: null } })
      .eq('id', assetId);

    // 2. Download from the public storage URL (createUploadAssetHandler put
    //    the file in the bucket and stored its public URL on source_uri).
    const fileRes = await fetch(asset.source_uri);
    if (!fileRes.ok) throw new Error(`Source fetch ${fileRes.status}`);
    const buffer = new Uint8Array(await fileRes.arrayBuffer());

    // 3. Extract text using the proper DS API signature
    //    ({ buffer, mimeType, fileName }) — NOT positional args.
    const doc = await extractDocumentText({
      buffer,
      mimeType: asset.source_mime_type || 'application/octet-stream',
      fileName: asset.source_filename || 'document',
    });

    // 4. Persist extracted_text immediately, BEFORE the Gemini extraction.
    //    Even if Gemini's skeleton extraction fails, the orchestrator can
    //    still feed the raw text into the system prompt as context.
    await supabase
      .from('assets')
      .update({
        extracted_text: doc.text,
        meta: {
          ...(asset.meta || {}),
          ingest_status: 'extracting',
          ingest_error: null,
          char_count: doc.charCount,
          format: doc.format,
        },
      })
      .eq('id', assetId);

    // 5. Run Gemini Pro for first-pass skeleton (analysis tier — 3.1 Pro).
    //    16k output cap. The full schema serializes to ~3KB JSON; 16k gives
    //    headroom for verbose RFPs without enabling 6-minute repetition
    //    loops we observed at 32k. responseSchema deliberately omitted —
    //    forcing Pro into a strict schema while ALSO mandating jsonMode +
    //    full-shape prompt was triggering degenerate token loops (literal
    //    "0000…0000" tails on a string field). The prompt + jsonMode is
    //    enough; pickBriefFields + sanitizeSkeleton enforce the shape after.
    //    Input slice 200k chars (~50k input tokens, inside Pro's 1M context).
    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });
    const result = await llm.generateContent({
      system: EXTRACTION_PROMPT,
      userParts: [
        { text: `## Document: ${asset.source_filename || 'document'}\n\n${doc.text.slice(0, 200000)}` },
      ],
      maxTokens: 16384,
      jsonMode: true,
      app: `${APP_NAME}:ingest`,
      userId,
    });

    let raw: any;
    try {
      raw = JSON.parse(result.text);
    } catch {
      raw = JSON.parse(repairJson(result.text));
    }
    if (looksDegenerate(raw)) {
      throw new Error('Skeleton extraction returned a degenerate output (repetition loop)');
    }
    const skeleton = pickBriefFields(raw);

    // 6. Write meta with the skeleton + final 'extracted' status
    const nextMeta = {
      ...(asset.meta || {}),
      ingest_status: 'extracted',
      ingest_error: null,
      brief_skeleton: skeleton,
      char_count: doc.charCount,
      format: doc.format,
    };
    await supabase
      .from('assets')
      .update({ meta: nextMeta })
      .eq('id', assetId);

    log.info('ingest-asset-background.complete', {
      function_name: 'ingest-asset-background',
      entity_id: assetId,
      user_id: userId,
      duration_ms: Date.now() - startTime,
      ai_input_tokens: result.usage.inputTokens,
      ai_output_tokens: result.usage.outputTokens,
      ai_total_tokens: result.usage.totalTokens,
    });

    return Response.json({ ok: true, assetId, skeleton });
  } catch (err) {
    log.error('ingest-asset-background.error', {
      function_name: 'ingest-asset-background',
      entity_id: assetId,
      user_id: userId,
      error: err,
      error_category: 'ai_api',
      duration_ms: Date.now() - startTime,
    });
    // Best-effort error stamp; preserve any extracted_text already written
    // (step 4 saves the raw text before Gemini runs, so even on skeleton
    // failure the orchestrator still has source content to work with).
    const { data: existing } = await supabase
      .from('assets').select('meta').eq('id', assetId).maybeSingle();
    await supabase
      .from('assets')
      .update({
        meta: {
          ...((existing?.meta as Record<string, unknown>) || {}),
          ingest_status: 'error',
          ingest_error: String(err).slice(0, 500),
        },
      })
      .eq('id', assetId);
    return Response.json({ error: String(err) }, { status: 500 });
  }
};

/**
 * Detect Gemini repetition-loop output. We saw cases where a field came
 * back as "Real text...000000…0000010" with hundreds of identical tokens
 * after a legitimate prefix. Treat any string with >40 consecutive
 * identical chars as garbage.
 */
function looksDegenerate(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const stack: unknown[] = [raw];
  let inspected = 0;
  while (stack.length && inspected < 500) {
    const v = stack.pop();
    inspected++;
    if (typeof v === 'string') {
      if (v.length > 80 && /(.)\1{40,}/.test(v)) return true;
    } else if (Array.isArray(v)) {
      for (const item of v) stack.push(item);
    } else if (v && typeof v === 'object') {
      for (const item of Object.values(v as Record<string, unknown>)) stack.push(item);
    }
  }
  return false;
}

/**
 * Strict pick: only declared Brief fields survive. Mirrors the 13-section
 * Brief in src/lib/types.ts. Drops anything Gemini may have hallucinated
 * outside the schema.
 */
function pickBriefFields(raw: any) {
  if (!raw || typeof raw !== 'object') return {};
  const arr = (v: unknown) => (Array.isArray(v) ? v : undefined);
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);

  const submission = obj(raw.submission);
  const goals = obj(raw.goals);
  const audience = obj(raw.audience);
  const budget = obj(raw.budget);
  const channels = obj(raw.channels);
  const creative = obj(raw.creative);
  const measurement = obj(raw.measurement);

  return {
    title: raw.title,
    agency: raw.agency,
    client: raw.client,
    industry: raw.industry,
    status: raw.status,
    submission: submission && {
      client: (submission as any).client,
      vertical: (submission as any).vertical,
      clientPOC: (submission as any).clientPOC,
      aidPOC: (submission as any).aidPOC,
      clientType: (submission as any).clientType,
      dueDate: (submission as any).dueDate,
      priority: (submission as any).priority,
    },
    background: typeof raw.background === 'string' ? raw.background : undefined,
    goals: goals && {
      awarenessObjective: (goals as any).awarenessObjective,
      awarenessMeasure: (goals as any).awarenessMeasure,
      conversionObjective: (goals as any).conversionObjective,
      conversionMeasure: (goals as any).conversionMeasure,
    },
    kpis: arr(raw.kpis),
    audience: audience && {
      primary: (audience as any).primary,
      personas: arr((audience as any).personas),
    },
    competitors: arr(raw.competitors),
    geos: arr(raw.geos),
    budget: budget && {
      lines: arr((budget as any).lines),
      flightStart: (budget as any).flightStart,
      flightEnd: (budget as any).flightEnd,
      phases: arr((budget as any).phases),
    },
    channels: channels && {
      lines: arr((channels as any).lines),
      successTactics: arr((channels as any).successTactics),
      failedTactics: arr((channels as any).failedTactics),
    },
    creative: creative && {
      materials: (creative as any).materials,
      production: (creative as any).production,
      commsPlatform: (creative as any).commsPlatform,
      rtb: (creative as any).rtb,
      brandLine: (creative as any).brandLine,
    },
    measurement: measurement && {
      benchmarks: (measurement as any).benchmarks,
      conversionAction: (measurement as any).conversionAction,
      reportingCadence: (measurement as any).reportingCadence,
      accountOwnership: (measurement as any).accountOwnership,
      inHouse: (measurement as any).inHouse,
      dashboarding: (measurement as any).dashboarding,
    },
    deliverables: arr(raw.deliverables),
    openQuestions: arr(raw.openQuestions),
  };
}
