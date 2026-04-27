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

const APP_NAME = 'campaign-brief-wizard';

// Strict schema: same Brief shape the orchestrator patches, minus runtime
// fields. The first-pass skeleton from a single doc is rarely complete —
// every field optional; missing = "this doc didn't say anything useful for
// that section", which is correct.
const BRIEF_SKELETON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    audience: { type: 'string' },
    objective: { type: 'string' },
    singleMindedProposition: { type: 'string' },
    currentMindset: { type: 'string' },
    desiredMindset: { type: 'string' },
    brand: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        archetype: { type: 'string' },
        toneOfVoice: { type: 'string' },
        personality: { type: 'array', items: { type: 'string' } },
        competitiveContext: { type: 'string' },
      },
    },
    channels: { type: 'array', items: { type: 'string' } },
    deliverables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          format: { type: 'string' },
          specs: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['id', 'format'],
      },
    },
    timing: {
      type: 'object',
      properties: {
        kickoffDate: { type: 'string' },
        launchDate: { type: 'string' },
        milestones: { type: 'array', items: { type: 'string' } },
      },
    },
    budget: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        currency: { type: 'string' },
        notes: { type: 'string' },
      },
    },
    mandatories: { type: 'array', items: { type: 'string' } },
    doNots: { type: 'array', items: { type: 'string' } },
    legalNotes: { type: 'string' },
  },
};

const EXTRACTION_PROMPT = `You are reading ONE source document for a campaign brief.
Extract only what's directly stated; do NOT infer, do NOT generalize.
Return a partial Brief in JSON matching the schema. Omit any field the
document doesn't explicitly cover.

If the document is research / a transcript / a deck rather than a brief,
prefer to populate audience, currentMindset, brand.competitiveContext.
If it's a prior brief or RFP, prefer objective, deliverables, timing,
budget, mandatories.

Never invent. Empty output is acceptable if the document has nothing usable.`;

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await req.json();
  const { sessionId, assetId, userId } = body;
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
      .select('id, name, type, storage_path')
      .eq('id', assetId)
      .maybeSingle();
    if (loadErr || !asset) throw new Error(`Asset ${assetId} not found`);

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
      responseSchema: BRIEF_SKELETON_SCHEMA,
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
 */
function pickBriefFields(raw: any) {
  return {
    title: raw.title,
    audience: raw.audience,
    objective: raw.objective,
    singleMindedProposition: raw.singleMindedProposition,
    currentMindset: raw.currentMindset,
    desiredMindset: raw.desiredMindset,
    brand: raw.brand && {
      name: raw.brand.name,
      archetype: raw.brand.archetype,
      toneOfVoice: raw.brand.toneOfVoice,
      personality: Array.isArray(raw.brand.personality) ? raw.brand.personality : undefined,
      competitiveContext: raw.brand.competitiveContext,
    },
    channels: Array.isArray(raw.channels) ? raw.channels : undefined,
    deliverables: Array.isArray(raw.deliverables) ? raw.deliverables : undefined,
    timing: raw.timing,
    budget: raw.budget,
    mandatories: Array.isArray(raw.mandatories) ? raw.mandatories : undefined,
    doNots: Array.isArray(raw.doNots) ? raw.doNots : undefined,
    legalNotes: raw.legalNotes,
  };
}
