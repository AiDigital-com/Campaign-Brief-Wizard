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
    //    8192 max tokens — schema can produce ~2-4KB JSON; previous 4096 cap
    //    was hitting truncation on rich RFPs. repairJson() recovers from any
    //    remaining truncation/comma/quote issues from Gemini's stream.
    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });
    const result = await llm.generateContent({
      system: EXTRACTION_PROMPT,
      userParts: [
        { text: `## Document: ${asset.source_filename || 'document'}\n\n${doc.text.slice(0, 60000)}` },
      ],
      maxTokens: 8192,
      jsonMode: true,
      responseSchema: BRIEF_JSON_SCHEMA as unknown as Record<string, unknown>,
      app: `${APP_NAME}:ingest`,
      userId,
    });

    let raw: any;
    try {
      raw = JSON.parse(result.text);
    } catch {
      raw = JSON.parse(repairJson(result.text));
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
