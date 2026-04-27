/**
 * Orchestrator — SSE streaming chat agent.
 *
 * Uses the DS LLM wrapper (createLLMProvider) for provider-agnostic AI calls.
 * NEVER use @google/genai directly — always go through the DS wrapper.
 *
 * Pattern: stream text deltas + tool calls via SSE. Frontend uses parseSSEStream().
 */
import { createLLMProvider, type ToolDefinition, type ToolCall, type ChatMessage } from '@AiDigital-com/design-system/server';
import { requireAuthOrEmbed } from './_shared/auth.js';
import { log } from './_shared/logger.js';
import { createClient } from '@supabase/supabase-js';

const APP_NAME = 'campaign-brief-wizard';

/**
 * patch_brief — the orchestrator's only structured output.
 *
 * Instead of a "dispatch when done" pattern (other apps), CBW's orchestrator
 * patches the brief artifact incrementally as the user converses. Each call
 * to this tool ships a partial Brief that the frontend shallow-merges into
 * the live artifact via SSE event { type: 'brief_patch', patch }.
 *
 * Use ONLY fields you have evidence for. Empty fields are intentional —
 * the frontend renders nothing for them (see CLAUDE.md "No content fallbacks").
 *
 * The schema MUST stay in sync with `src/lib/types.ts:Brief`. If you add a
 * field there, add it here, AND add it to the responseSchema in any
 * `-background` Lambda that writes the brief.
 */
const PATCH_BRIEF_TOOL: ToolDefinition = {
  name: 'patch_brief',
  description:
    'Apply a partial update to the campaign brief artifact. Include ONLY fields ' +
    'you have direct evidence for from the conversation or uploaded sources. ' +
    'Omit anything speculative — the user can see when the brief is incomplete ' +
    'and will guide you. Each patch is shallow-merged into the live brief.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Plain-English brief title (10-15 words).' },
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
      openQuestions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Specific questions you still need answered to complete the brief. ' +
          'Phrase them so the user can answer in one short sentence each.',
      },
    },
  },
};

const SYSTEM_PROMPT = `You are the strategist behind Campaign Brief Wizard.

Your job is to co-author a coherent campaign brief with the user, iteratively.
The user is a marketing lead at AI Digital. They will:
  - drop in raw source material (research, transcripts, prior briefs, decks)
  - chat with you about the campaign goal, audience, constraints

You produce two outputs in parallel on every turn:
  1. A short, useful chat reply (text deltas) — answer their question, ask
     ONE focused follow-up at a time, never a wall of text.
  2. Patches to the brief artifact via patch_brief — fill in fields you have
     evidence for, leave the rest empty. Use openQuestions to surface what
     you still need to know.

Rules:
  - NEVER invent verdict prose. If you don't have enough info for a field,
    don't include it in the patch — the artifact will simply show nothing
    for that field, which is correct.
  - Reference uploaded sources by filename when patching from extracted text.
  - Keep the chat conversational. The artifact is the deliverable.
  - When the brief reaches a coherent draft (audience + objective + SMP +
    at least one deliverable + timing OR budget), say so explicitly so the
    user can export.`;

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
  const { messages = [], userId } = body;
  const uid = userId || authUserId;

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const llm = createLLMProvider('gemini', process.env.GEMINI_API_KEY!, 'fast', { supabase });

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
        meta: { messageCount: messages?.length },
      });
      const startTime = Date.now();

      try {
        const result = await llm.streamChat({
          system: SYSTEM_PROMPT,
          messages: chatMessages,
          tools: [PATCH_BRIEF_TOOL],
          callbacks: {
            onText: (text) => emit({ type: 'text_delta', text }),
            onToolCalls: (calls: ToolCall[]) => {
              for (const call of calls) {
                if (call.name === 'patch_brief') {
                  // Frontend shallow-merges this into the live Brief artifact
                  // and persists via session.merge.
                  emit({ type: 'brief_patch', patch: call.args });
                }
              }
            },
          },
          app: `${APP_NAME}:orchestrator`,
          userId: uid,
        });

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
        console.error('Orchestrator error:', err);
        log.error('orchestrator.error', {
          function_name: 'orchestrator',
          user_id: uid,
          user_email: authEmail,
          error: err,
          error_category: 'ai_api',
          duration_ms: Date.now() - startTime,
        });
        emit({ type: 'error', message: String(err) });
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
