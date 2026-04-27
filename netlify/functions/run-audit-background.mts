/**
 * Example -background Lambda: ingests intake → runs an LLM extraction pass with
 * `responseSchema` enforcement → writes the result to the session row.
 *
 * MANDATORY patterns demonstrated here:
 *   1. `-background` filename suffix       → 15-min Netlify budget (vs 26s)
 *   2. `responseSchema` on every Gemini call → API-level field enforcement
 *   3. Strict assembler destructure         → only declared v2 fields persist
 *   4. Structured logging via DS `log`      → observable in activity_log
 *
 * Triggered by task-worker, not called directly. Must accept POST with
 * the pipeline_tasks payload as JSON body.
 *
 * TODO: Replace EXAMPLE_SCHEMA + system prompt + assembler with your domain.
 */
import { createLLMProvider } from '@AiDigital-com/design-system/server';
import { createClient } from '@supabase/supabase-js';
import { log } from './_shared/logger.js';

// Strict JSON schema for the extraction output. Gemini is forced to return
// EXACTLY this shape — no extra fields, no missing required fields, no renamed
// keys. If structure drifts, the API call fails visibly instead of silently
// writing garbage to DB.
const EXAMPLE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['id', 'title', 'description'],
      },
    },
  },
  required: ['headline', 'summary', 'severity', 'findings'],
};

interface ExtractionResult {
  headline: string;
  summary: string;
  severity: 'low' | 'medium' | 'high';
  findings: Array<{ id: string; title: string; description: string }>;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await req.json();
  const { jobId, intakeSummary, userId } = body;
  if (!jobId) return Response.json({ error: 'Missing jobId' }, { status: 400 });

  const startTime = Date.now();
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  log.info('run-audit-background.start', {
    function_name: 'run-audit-background',
    entity_id: jobId,
    user_id: userId,
  });

  try {
    const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });

    const result = await llm.generateContent({
      system: 'You are an analyst. Extract a strict JSON object matching the schema.',
      userParts: [{ text: JSON.stringify(intakeSummary) }],
      maxTokens: 8192,
      jsonMode: true,
      responseSchema: EXAMPLE_SCHEMA,
      app: 'your-app-name:run-audit',
      userId,
    });

    const raw = JSON.parse(result.text);

    // STRICT destructure — only declared fields survive. Even though
    // responseSchema enforces API-level shape, this is defense in depth: if
    // the schema is ever loosened or Gemini's enforcement drifts, ghost fields
    // still can't reach the DB.
    const clean: ExtractionResult = {
      headline: raw.headline,
      summary: raw.summary,
      severity: raw.severity,
      findings: Array.isArray(raw.findings) ? raw.findings : [],
    };

    // Update the session row with the result.
    const { error } = await supabase
      .from('your_sessions')
      .update({ report_data: clean, status: 'complete', updated_at: new Date().toISOString() })
      .eq('id', jobId);

    if (error) throw error;

    log.info('run-audit-background.complete', {
      function_name: 'run-audit-background',
      entity_id: jobId,
      user_id: userId,
      duration_ms: Date.now() - startTime,
      ai_input_tokens: result.usage.inputTokens,
      ai_output_tokens: result.usage.outputTokens,
      ai_total_tokens: result.usage.totalTokens,
    });

    return Response.json({ ok: true, jobId });
  } catch (err) {
    log.error('run-audit-background.error', {
      function_name: 'run-audit-background',
      entity_id: jobId,
      user_id: userId,
      error: err,
      error_category: 'ai_api',
      duration_ms: Date.now() - startTime,
    });

    await supabase
      .from('your_sessions')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', jobId);

    return Response.json({ error: String(err) }, { status: 500 });
  }
};
