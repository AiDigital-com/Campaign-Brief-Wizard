/**
 * Client-side brief merge — mirrors the orchestrator's server-side
 * applyBriefPatch (netlify/functions/_shared/brief.ts).
 *
 * 1-level deep merge: for top-level keys whose value is a plain object on
 * both sides, fields shallow-merge. Arrays and primitives always replace.
 *
 * The optimistic UI calls this on each `brief_patch` SSE event so the
 * artifact pane updates as Gemini streams its tool calls. The server
 * commits a single version row per turn (with the same final state).
 */
import type { Brief } from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeBrief(current: Brief | null, patch: Partial<Brief>): Brief {
  const base: Record<string, unknown> = current ? { ...current } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    const existing = base[k];
    if (isPlainObject(existing) && isPlainObject(v)) {
      const merged: Record<string, unknown> = { ...existing };
      for (const [fk, fv] of Object.entries(v)) {
        if (fv === undefined) continue;
        merged[fk] = fv;
      }
      base[k] = merged;
    } else {
      base[k] = v;
    }
  }
  base.lastUpdatedAt = new Date().toISOString();
  return base as Brief;
}
