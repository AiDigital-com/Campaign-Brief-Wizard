/**
 * Session merge endpoint — atomic read-merge-write for cbw_sessions.
 *
 * NOTE: We can't use DS mergeSession() because its ALLOWED_TABLES safelist
 * doesn't include 'cbw_sessions' (yet — adding that to DS requires a
 * package bump + republish; tracking as a follow-up). Inlining the same
 * merge semantics here:
 *   - 'messages' is merged by id (preserves order, longer content wins)
 *   - keys in mergeConfig.objectFields are shallow-merged
 *   - everything else is replaced
 *
 * Required by useSessionPersistence — every chat app needs this endpoint.
 */
import type { Context } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const SESSION_TABLE = 'cbw_sessions';

interface MergeConfig {
  objectFields?: string[];
}

interface MessageLike {
  id?: string;
  content?: string;
  [k: string]: unknown;
}

function mergeMessages(existing: MessageLike[], incoming: MessageLike[]): MessageLike[] {
  const map = new Map<string, MessageLike>();
  const order: string[] = [];
  const keyOf = (m: MessageLike, i: number) => m.id || `__pos_${i}`;
  for (let i = 0; i < existing.length; i++) {
    const k = keyOf(existing[i], i);
    map.set(k, existing[i]);
    if (!order.includes(k)) order.push(k);
  }
  for (let i = 0; i < incoming.length; i++) {
    const k = keyOf(incoming[i], i);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, incoming[i]);
      if (!order.includes(k)) order.push(k);
    } else {
      // Longer content wins — protects streamed updates from clobbering with
      // stale empty placeholders.
      const inLen = (incoming[i].content || '').length;
      const exLen = (prev.content || '').length;
      if (inLen >= exLen) map.set(k, incoming[i]);
    }
  }
  return order.map((k) => map.get(k)!).filter(Boolean);
}

function mergePatch(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
  cfg: MergeConfig,
): Record<string, unknown> {
  const objectFields = new Set(cfg.objectFields || []);
  const out: Record<string, unknown> = {};
  for (const [key, newValue] of Object.entries(patch)) {
    if (newValue === undefined) continue;
    const existingValue = existing[key];
    if (key === 'messages' && Array.isArray(newValue)) {
      out[key] = mergeMessages(
        Array.isArray(existingValue) ? (existingValue as MessageLike[]) : [],
        newValue as MessageLike[],
      );
    } else if (objectFields.has(key) && newValue && typeof newValue === 'object' && !Array.isArray(newValue)) {
      const existObj = existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)
        ? (existingValue as Record<string, unknown>)
        : {};
      out[key] = { ...existObj, ...(newValue as Record<string, unknown>) };
    } else if (newValue !== null && newValue !== '') {
      out[key] = newValue;
    }
  }
  return out;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, patch, mergeConfig } = await req.json();
  if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const cfg: MergeConfig = mergeConfig || { objectFields: ['brief_data', 'intake_summary'] };

  // Read-merge-write loop. If the row doesn't exist yet (race with
  // useSessionPersistence.createSession) fall through to insert.
  const { data: existing, error: readErr } = await supabase
    .from(SESSION_TABLE)
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (readErr) {
    return Response.json({ error: readErr.message }, { status: 500 });
  }

  if (!existing) {
    // First write of a brand-new session — insert directly.
    const insertRow = { id: sessionId, ...patch, updated_at: new Date().toISOString() };
    const { error: insertErr } = await supabase.from(SESSION_TABLE).insert(insertRow);
    if (insertErr) {
      // Race: someone else just inserted. Re-read and merge.
      const { data: now } = await supabase.from(SESSION_TABLE).select('*').eq('id', sessionId).maybeSingle();
      if (!now) return Response.json({ error: insertErr.message }, { status: 500 });
      const merged = mergePatch(now as Record<string, unknown>, patch, cfg);
      merged.updated_at = new Date().toISOString();
      const { error: writeErr } = await supabase.from(SESSION_TABLE).update(merged).eq('id', sessionId);
      if (writeErr) return Response.json({ error: writeErr.message }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  const merged = mergePatch(existing as Record<string, unknown>, patch, cfg);
  if ('updated_at' in (existing as Record<string, unknown>)) {
    merged.updated_at = new Date().toISOString();
  }
  const { error: writeErr } = await supabase.from(SESSION_TABLE).update(merged).eq('id', sessionId);
  if (writeErr) return Response.json({ error: writeErr.message }, { status: 500 });

  return Response.json({ ok: true });
};
