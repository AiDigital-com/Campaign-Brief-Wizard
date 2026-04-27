/**
 * Orchestrator — SSE streaming chat agent for Campaign Brief Wizard.
 *
 * Per-turn flow:
 *   1. Load the current Brief from cbw_sessions.brief_data (if sessionId given)
 *   2. Load asset brief_skeletons (extracted partial briefs from each upload)
 *   3. Stream chat reply + patch_brief tool calls from Gemini 3.1 Pro
 *   4. Each patch_brief: emit `brief_patch` SSE event (UI optimistic merge)
 *      AND accumulate into a per-turn merged patch
 *   5. End of turn: server merges all patches, appends ONE version row via
 *      cbw_append_version RPC, emits `version_committed` SSE event
 *
 * Model: gemini-3.1-pro-preview ('analysis' tier) — this is a reasoning-heavy
 * problem-solving role, not a quick chat. Pro tier mandatory.
 */
import { createLLMProvider, type ToolDefinition, type ToolCall, type ChatMessage } from '@AiDigital-com/design-system/server';
import { requireAuthOrEmbed } from './_shared/auth.js';
import { log } from './_shared/logger.js';
import { applyBriefPatch, appendBriefVersion, BRIEF_JSON_SCHEMA } from './_shared/brief.js';
import { createClient } from '@supabase/supabase-js';

const APP_NAME = 'campaign-brief-wizard';

const PATCH_BRIEF_TOOL: ToolDefinition = {
  name: 'patch_brief',
  description:
    'Apply a partial update to the campaign brief artifact (the 13-section ' +
    'media brief). Include ONLY fields you have direct evidence for from the ' +
    'conversation or uploaded sources. Omit anything speculative — the user ' +
    'sees blank fields as "still gathering" which is correct. Each call is ' +
    'merged into the live brief; sections may be patched across multiple ' +
    'tool calls within the same turn.',
  parameters: BRIEF_JSON_SCHEMA as unknown as Record<string, unknown>,
};

const SYSTEM_PROMPT = `You are the strategist behind AI Digital's Campaign Brief Wizard.

Your job: co-author a complete 13-section media brief with the user, iteratively.
The user is a marketing lead at AI Digital. They drop in raw source material
(RFPs, follow-up emails, prior decks, audience CSVs, brand guidelines, URLs)
and chat with you about the campaign.

You produce two outputs in parallel on every turn:
  1. A short, useful chat reply — answer their last point, ask ONE focused
     follow-up at a time, never a wall of text. Keep it conversational; the
     artifact is the deliverable.
  2. Patches to the brief artifact via the patch_brief tool — fill in fields
     you have evidence for, leave the rest empty.

The brief has 13 sections. Each section maps to a top-level key:
  01 submission       — client / vertical / POCs / due date / priority
  02 background       — narrative paragraph on business + market context
  03 goals            — awareness + conversion objectives & measures
  04 kpis             — array of { label, base, target }
  05 audience         — primary description + persona array
  06 competitors      — array of competitor names / descriptions
  07 geos             — array of { city, market, primary }
  08 budget           — line items + flight dates + flight phases
  09 channels         — channel lines + successTactics + failedTactics
  10 creative         — materials / production / comms platform / RTB / brand line
  11 measurement      — benchmarks / conversion action / cadence / ownership / in-house / dashboarding
  12 deliverables     — array of { kind, eta, note }
  13 openQuestions    — array of focused questions you still need answered

Doc-level meta also patchable: title, agency, client, industry, status.

Iteration discipline:
  - NEVER invent verdict prose. If you don't have enough info for a field,
    omit it from the patch — the artifact renders nothing for that field
    and the user can see the gap.
  - Reference uploaded sources by filename when patching from extracted text.
  - Keep openQuestions tight: 3-5 focused, answerable-in-one-sentence items.
  - When the brief reaches a coherent draft (background + goals + audience +
    at least one deliverable + budget OR timing), say so explicitly so the
    user can export.
  - Treat empty arrays/strings as "not yet known" not "the answer is none".`;

/** True if the skeleton has at least one meaningfully populated value.
 *  After slice 11.5 the extraction prompt mandates every top-level key
 *  appear in the output (with empty defaults), so `Object.keys().length`
 *  is no longer a useful signal. We walk the values and treat
 *  empty-string / empty-array / empty-object as "no content". */
function hasSkeletonContent(skel: Record<string, unknown> | null | undefined): boolean {
  if (!skel) return false;
  for (const v of Object.values(skel)) {
    if (v == null) continue;
    if (typeof v === 'string') { if (v.trim()) return true; continue; }
    if (Array.isArray(v)) { if (v.length > 0) return true; continue; }
    if (typeof v === 'object') {
      for (const inner of Object.values(v as Record<string, unknown>)) {
        if (inner == null) continue;
        if (typeof inner === 'string' && inner.trim()) return true;
        if (Array.isArray(inner) && inner.length > 0) return true;
        if (typeof inner === 'object' && inner !== null && Object.keys(inner as object).length > 0) return true;
      }
      continue;
    }
    return true; // numbers, booleans
  }
  return false;
}

function buildSkeletonContext(
  skeletons: Array<{
    name: string;
    brief_skeleton: Record<string, unknown> | null;
    extracted_excerpt: string | null;
  }>,
): string {
  if (!skeletons.length) return '';
  const blocks: string[] = [];
  for (const s of skeletons) {
    if (hasSkeletonContent(s.brief_skeleton)) {
      blocks.push(`### ${s.name}\n\`\`\`json\n${JSON.stringify(s.brief_skeleton, null, 2)}\n\`\`\``);
    } else if (s.extracted_excerpt) {
      // Either skeleton extraction failed, or the document had no fillable
      // structure — surface raw text so the strategist can still pull
      // evidence from this source.
      blocks.push(`### ${s.name} — raw text excerpt\n\`\`\`\n${s.extracted_excerpt}\n\`\`\``);
    }
  }
  if (!blocks.length) return '';
  return `\n\n## Source materials\n\nThe following content was extracted from uploaded sources. Use it as evidence when patching the brief — and reference the source filename in your reply when you do.\n\n${blocks.join('\n\n')}`;
}

function buildBriefContext(brief: Record<string, unknown> | null | undefined): string {
  if (!brief || Object.keys(brief).length === 0) return '\n\n## Current brief\n\n(empty — this is a fresh session)';
  return `\n\n## Current brief (snapshot before this turn)\n\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\``;
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let authEmail: string | null = null;
  let authUserId: string | null = null;
  try {
    const auth = await requireAuthOrEmbed(req);
    authEmail = auth.email;
    authUserId = auth.userId;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { messages = [], userId, sessionId, triggerMessageId } = body;
  const uid = userId || authUserId;

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // Pro tier: gemini-3.1-pro-preview — this is a thinking/problem-solving role.
  const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'analysis', { supabase });

  // ── Load context (current brief + extracted asset skeletons) ────────────
  // Asset rows live in the canonical `assets` table (created by the DS upload
  // handler). CBW-specific extraction state is on `meta.brief_skeleton`.
  // Even rows where Gemini's structured extraction failed are useful — we
  // fall back to a slice of `extracted_text` so the strategist still sees
  // the source material.
  let currentBrief: Record<string, unknown> = {};
  let skeletons: Array<{
    name: string;
    brief_skeleton: Record<string, unknown> | null;
    extracted_excerpt: string | null;
  }> = [];
  if (sessionId) {
    const [{ data: sess }, { data: assets }] = await Promise.all([
      supabase.from('cbw_sessions').select('brief_data').eq('id', sessionId).maybeSingle(),
      // Pull every asset for this session — including ones still extracting
      // or failed. The context builder decides what to surface.
      supabase
        .from('assets')
        .select('source_filename, meta, extracted_text')
        .eq('session_id', sessionId)
        .eq('created_by_app', APP_NAME),
    ]);
    if (sess?.brief_data) currentBrief = sess.brief_data as Record<string, unknown>;
    if (assets) {
      skeletons = (assets as Array<{
        source_filename: string | null;
        meta: Record<string, unknown> | null;
        extracted_text: string | null;
      }>).map((a) => ({
        name: a.source_filename || 'document',
        brief_skeleton: (a.meta?.brief_skeleton as Record<string, unknown> | undefined) || null,
        extracted_excerpt: a.extracted_text ? a.extracted_text.slice(0, 8000) : null,
      }));
    }
  }

  const systemWithContext =
    SYSTEM_PROMPT + buildBriefContext(currentBrief) + buildSkeletonContext(skeletons);

  const chatMessages: ChatMessage[] = messages.map((m: { role: string; content: string }) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const keepAliveInterval = setInterval(() => {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15_000);

      log.info('orchestrator.start', {
        function_name: 'orchestrator',
        user_id: uid,
        user_email: authEmail,
        ai_provider: llm.provider,
        ai_model: llm.model,
        meta: { sessionId, messageCount: messages?.length, skeletonCount: skeletons.length },
      });
      const startTime = Date.now();

      // Per-turn merged patch (server-authoritative). Each patch_brief call
      // is layered on top of `mergedBrief`; we accumulate patch input into
      // `combinedPatch` so the version row records what the turn changed.
      let mergedBrief: Record<string, unknown> = { ...currentBrief };
      const combinedPatch: Record<string, unknown> = {};

      try {
        const result = await llm.streamChat({
          system: systemWithContext,
          messages: chatMessages,
          tools: [PATCH_BRIEF_TOOL],
          callbacks: {
            onText: (text) => emit({ type: 'text_delta', text }),
            onToolCalls: (calls: ToolCall[]) => {
              for (const call of calls) {
                if (call.name !== 'patch_brief') continue;
                const args = (call.args || {}) as Record<string, unknown>;
                // Apply optimistically server-side
                const { next, changedSections } = applyBriefPatch(mergedBrief, args);
                mergedBrief = next;
                // Accumulate raw patch fields for the version row
                for (const [k, v] of Object.entries(args)) {
                  if (v !== undefined) combinedPatch[k] = v;
                }
                emit({ type: 'brief_patch', patch: args, changedSections });
              }
            },
          },
          app: `${APP_NAME}:orchestrator`,
          userId: uid,
        });

        // ── Persist a single version row for this turn (if anything changed) ─
        if (sessionId && Object.keys(combinedPatch).length > 0) {
          const { changedSections } = applyBriefPatch(currentBrief, combinedPatch);
          if (changedSections.length > 0) {
            try {
              const version = await appendBriefVersion(supabase, {
                sessionId,
                userId: uid,
                briefData: mergedBrief,
                patch: combinedPatch,
                changedSections,
                triggerMessageId: triggerMessageId || null,
                triggerKind: 'chat',
                rationale: null,
              });
              emit({
                type: 'version_committed',
                versionNumber: version.version_number,
                changedSections: version.changed_sections,
                versionId: version.id,
              });
            } catch (err) {
              log.error('orchestrator.version_append_failed', {
                function_name: 'orchestrator',
                user_id: uid,
                meta: { sessionId, error: String(err) },
              });
              emit({ type: 'version_error', message: String(err) });
            }
          }
        }

        log.info('orchestrator.complete', {
          function_name: 'orchestrator',
          user_id: uid,
          user_email: authEmail,
          duration_ms: Date.now() - startTime,
          ai_provider: llm.provider,
          ai_model: llm.model,
          ai_input_tokens: result.usage.inputTokens,
          ai_output_tokens: result.usage.outputTokens,
          ai_total_tokens: result.usage.totalTokens,
          ai_thinking_tokens: result.usage.thinkingTokens,
        });
        emit({ type: 'done' });
      } catch (err) {
        const errMessage = err instanceof Error
          ? err.message
          : (typeof err === 'string' ? err : JSON.stringify(err));
        const errStack = err instanceof Error ? err.stack : undefined;
        console.error('Orchestrator error:', errMessage, errStack);
        log.error('orchestrator.error', {
          function_name: 'orchestrator',
          user_id: uid,
          user_email: authEmail,
          // Plain string fields so the activity_log row has something
          // queryable; the previous `error: err` serialized to "[object Object]".
          error: errMessage,
          error_category: 'ai_api',
          duration_ms: Date.now() - startTime,
          meta: { sessionId, errStack },
        });
        emit({ type: 'error', message: errMessage });
      } finally {
        clearInterval(keepAliveInterval);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
