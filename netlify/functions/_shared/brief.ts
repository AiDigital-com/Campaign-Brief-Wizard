/**
 * Brief patching + versioning helpers.
 *
 * One-level deep merge: for top-level section keys whose value is a plain
 * object on both sides, fields shallow-merge. Arrays and primitives always
 * replace. This preserves incremental field updates inside sections like
 * `submission`, `goals`, `budget` while letting the orchestrator atomically
 * replace list-shaped sections (`kpis`, `competitors`, `geos`, `channels.lines`).
 *
 * The result is the new brief snapshot. We also compute which top-level
 * section keys actually changed (post-merge), which drives the Updated
 * overlay and the change banner in chat.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const SECTION_KEYS = [
  'submission', 'background', 'goals', 'kpis', 'audience', 'competitors',
  'geos', 'budget', 'channels', 'creative', 'measurement', 'deliverables',
  'openQuestions',
] as const;

const META_KEYS = ['title', 'agency', 'client', 'industry', 'status'] as const;

const ALL_PATCHABLE_KEYS = new Set<string>([...SECTION_KEYS, ...META_KEYS]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Apply a partial Brief patch to the current brief.
 * Returns the merged brief AND the list of top-level section keys that
 * actually changed value (relative to `current`).
 */
export function applyBriefPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): { next: Record<string, unknown>; changedSections: string[] } {
  const next: Record<string, unknown> = { ...current };
  const changed: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (!ALL_PATCHABLE_KEYS.has(key)) continue;            // drop unknown keys
    if (value === undefined || value === null) continue;   // null doesn't clear; explicit empty array/object does

    const existing = current[key];
    let merged: unknown;

    if (isPlainObject(existing) && isPlainObject(value)) {
      // Shallow-merge fields inside the section. Skip undefined values.
      merged = { ...existing };
      for (const [fk, fv] of Object.entries(value)) {
        if (fv === undefined) continue;
        (merged as Record<string, unknown>)[fk] = fv;
      }
    } else {
      merged = value;
    }

    if (!deepEqual(existing, merged)) {
      next[key] = merged;
      // META_KEYS are not section keys — they don't go into changedSections
      if ((SECTION_KEYS as readonly string[]).includes(key)) {
        changed.push(key);
      }
    }
  }

  next.lastUpdatedAt = new Date().toISOString();
  return { next, changedSections: changed };
}

/**
 * Append a new version row via the `cbw_append_version` RPC.
 * The RPC bumps version_number atomically and updates cbw_sessions.brief_data.
 */
export async function appendBriefVersion(
  supabase: SupabaseClient,
  args: {
    sessionId: string;
    userId: string;
    briefData: Record<string, unknown>;
    patch: Record<string, unknown> | null;
    changedSections: string[];
    triggerMessageId: string | null;
    triggerKind: 'chat' | 'ingest' | 'manual_edit';
    rationale: string | null;
  },
) {
  const { data, error } = await supabase.rpc('cbw_append_version', {
    p_session_id: args.sessionId,
    p_user_id: args.userId,
    p_brief_data: args.briefData,
    p_patch: args.patch,
    p_changed_sections: args.changedSections,
    p_trigger_message_id: args.triggerMessageId,
    p_trigger_kind: args.triggerKind,
    p_rationale: args.rationale,
  });
  if (error) throw error;
  return data as {
    id: string;
    session_id: string;
    version_number: number;
    brief_data: Record<string, unknown>;
    patch: Record<string, unknown> | null;
    changed_sections: string[];
    created_at: string;
  };
}

/**
 * JSON Schema fragment for the Brief — shared by orchestrator's
 * patch_brief tool and ingest's brief_skeleton extraction.
 *
 * MUST stay in sync with `src/lib/types.ts:Brief`. Adding a field here
 * without updating types.ts (or vice versa) creates a silent drift bug.
 */
export const BRIEF_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    agency: { type: 'string' },
    client: { type: 'string' },
    industry: { type: 'string' },
    status: { type: 'string' },

    submission: {
      type: 'object',
      properties: {
        client: { type: 'string' },
        vertical: { type: 'string' },
        clientPOC: { type: 'string' },
        aidPOC: { type: 'string' },
        clientType: { type: 'string' },
        dueDate: { type: 'string' },
        priority: { type: 'string' },
      },
    },

    background: { type: 'string' },

    goals: {
      type: 'object',
      properties: {
        awarenessObjective: { type: 'string' },
        awarenessMeasure: { type: 'string' },
        conversionObjective: { type: 'string' },
        conversionMeasure: { type: 'string' },
      },
    },

    kpis: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          base: { type: 'string' },
          target: { type: 'string' },
        },
        required: ['label', 'target'],
      },
    },

    audience: {
      type: 'object',
      properties: {
        primary: { type: 'string' },
        personas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'string' },
              role: { type: 'string' },
              quote: { type: 'string' },
              initial: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
    },

    competitors: { type: 'array', items: { type: 'string' } },

    geos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          market: { type: 'string' },
          primary: { type: 'boolean' },
        },
        required: ['city'],
      },
    },

    budget: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              amount: { type: 'number' },
            },
            required: ['label', 'amount'],
          },
        },
        flightStart: { type: 'string' },
        flightEnd: { type: 'string' },
        phases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              startPct: { type: 'number' },
              widthPct: { type: 'number' },
              tone: { type: 'string', enum: ['sample', 'burst', 'sustain'] },
            },
            required: ['name', 'startPct', 'widthPct'],
          },
        },
      },
    },

    channels: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              name: { type: 'string' },
              amount: { type: 'number' },
            },
            required: ['code', 'name', 'amount'],
          },
        },
        successTactics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              name: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['name'],
          },
        },
        failedTactics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              name: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
    },

    creative: {
      type: 'object',
      properties: {
        materials: { type: 'string' },
        production: { type: 'string' },
        commsPlatform: { type: 'string' },
        rtb: { type: 'string' },
        brandLine: { type: 'string' },
      },
    },

    measurement: {
      type: 'object',
      properties: {
        benchmarks: { type: 'string' },
        conversionAction: { type: 'string' },
        reportingCadence: { type: 'string' },
        accountOwnership: { type: 'string' },
        inHouse: { type: 'string' },
        dashboarding: { type: 'string' },
      },
    },

    deliverables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          eta: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['kind'],
      },
    },

    openQuestions: { type: 'array', items: { type: 'string' } },
  },
} as const;
