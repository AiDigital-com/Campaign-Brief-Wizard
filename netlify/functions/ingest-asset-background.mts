/**
 * ingest-asset-background — extract usable text from an uploaded asset
 * and (optionally) emit a first-pass brief skeleton from it.
 *
 * Triggered by the AssetRail upload flow:
 *   client uploads file to Supabase storage `cbw-assets` →
 *   POST /.netlify/functions/ingest-asset-background { sessionId, assetId }
 *
 * Why -background: PDF/DOCX text extraction + a Gemini summarization pass
 * can comfortably exceed Netlify's 26s streaming-mode timeout on large
 * decks. -background suffix flips this to 15-min budget.
 *
 * Output: writes to `cbw_assets.extracted_text` + `cbw_assets.brief_skeleton`,
 * sets `ingest_status` so the UI's per-asset chip flips green. The
 * orchestrator then has access to the extracted text on subsequent turns.
 *
 * TODO (parallel thread): wire DS document extractors:
 *   - PDF → unpdf (already a DS dep)
 *   - DOCX → mammoth (already a DS dep)
 *   - Image → Gemini vision pass with responseSchema for OCR + caption
 *
 * Strict pattern reminders (also in template CLAUDE.md):
 *   - All LLM calls via createLLMProvider — no direct @google/genai use
 *   - Use responseSchema on the brief_skeleton extraction call
 *   - Strict destructure on the saved skeleton — only declared fields
 *     reach the DB; junk Gemini echoes from source markdown gets dropped
 */
import { createLLMProvider } from '@AiDigital-com/design-system/server';
import { extractDocumentText } from '@AiDigital-com/design-system/document';
import { createClient } from '@supabase/supabase-js';
import { log } from './_shared/logger.js';
import { requireAuthOrEmbed } from './_shared/auth.js';
import { BRIEF_JSON_SCHEMA } from './_shared/brief.js';

const APP_NAME = 'campaign-brief-wizard';

const EXTRACTION_PROMPT = `You are reading ONE source document for a 13-section
campaign media brief. Extract only what's directly stated; do NOT infer, do NOT
generalize. Return a partial Brief in JSON matching the provided schema. Omit
any section or field the document doesn't explicitly cover.

The 13 sections: submission, background, goals, kpis, audience, competitors,
geos, budget, channels, creative, measurement, deliverables, openQuestions.

Heuristics by document type:
  - RFP / brief: prefer submission, background, goals, deliverables, budget, geos
  - Audience research / persona deck: prefer audience.primary + audience.personas, competitors
  - Recap / benchmark deck: prefer kpis, channels (with success/failed tactics), measurement
  - Brand guidelines: prefer creative (brandLine, materials, RTB)
  - Email thread / call transcript: prefer background, openQuestions, any explicit constraint

Never invent. Empty output is acceptable if the document has nothing usable.
For arrays (kpis, personas, geos, deliverables, openQuestions, etc.) include
ONLY items the document explicitly mentions.`;

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let authUserId: string;
  try {
    const auth = await requireAuthOrEmbed(req);
    authUserId = auth.userId;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { sessionId, assetId } = body;
  const userId = authUserId;
  if (!sessionId || !assetId) {
    return Response.json({ error: 'Missing sessionId or assetId' }, { status: 400 });
  }

  const startTime = Date.now();
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  log.info('ingest-asset-background.start', {
    function_name: 'ingest-asset-background',
    entity_id: assetId,
    user_id: userId,
    meta: { sessionId },
  });

  try {
    // 1. Load asset row to get the storage URL + filename
    const { data: asset, error: loadErr } = await supabase
      .from('cbw_assets')
      .select('id, name, type, storage_path, user_id')
      .eq('id', assetId)
      .maybeSingle();
    if (loadErr || !asset) throw new Error(`Asset ${assetId} not found`);
    if (asset.user_id !== userId) throw new Error('Forbidden');

    await supabase.from('cbw_assets').update({ ingest_status: 'extracting' }).eq('id', assetId);

    // 2. Download from Supabase storage and extract text
    const { data: file, error: downErr } = await supabase.storage
      .from('cbw-assets')
      .download(asset.storage_path);
    if (downErr || !file) throw new Error(`Storage download failed: ${downErr?.message}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    const extractedText = await extractDocumentText(buffer, asset.name);

    // 3. Run Gemini with strict responseSchema for first-pass skeleton
    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });
    const result = await llm.generateContent({
      system: EXTRACTION_PROMPT,
      userParts: [{ text: `## Document: ${asset.name}\n\n${extractedText.slice(0, 60000)}` }],
      maxTokens: 4096,
      jsonMode: true,
      responseSchema: BRIEF_JSON_SCHEMA as unknown as Record<string, unknown>,
      app: `${APP_NAME}:ingest`,
      userId,
    });

    const raw = JSON.parse(result.text);

    // 4. Strict destructure — only declared fields reach DB
    const skeleton = pickBriefFields(raw);

    await supabase.from('cbw_assets').update({
      extracted_text: extractedText,
      brief_skeleton: skeleton,
      ingest_status: 'extracted',
      updated_at: new Date().toISOString(),
    }).eq('id', assetId);

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
    await supabase
      .from('cbw_assets')
      .update({ ingest_status: 'error', ingest_error: String(err).slice(0, 500) })
      .eq('id', assetId);
    return Response.json({ error: String(err) }, { status: 500 });
  }
};

/**
 * Strict pick: only declared Brief fields survive. Drops anything Gemini
 * may have hallucinated outside the schema (defense in depth — the schema
 * already enforces this, but we keep the explicit pick so future schema
 * loosening doesn't accidentally let ghost fields through).
 *
 * Mirrors the 13-section Brief in src/lib/types.ts.
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
