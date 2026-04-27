/**
 * BriefVersionsPopover — read-only history of cbw_brief_versions for the
 * current session. Opens from the version pill click. Slice 8 keeps it
 * read-only; "restore to version" is a future item.
 */
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@AiDigital-com/design-system';
import type { BriefSectionKey } from '../lib/types';

interface Row {
  id: string;
  version_number: number;
  changed_sections: string[];
  rationale: string | null;
  trigger_kind: string | null;
  created_at: string;
}

const SECTION_LABEL: Record<BriefSectionKey, string> = {
  submission: 'Submission',
  background: 'Background',
  goals: 'Goals',
  kpis: 'KPIs',
  audience: 'Audience',
  competitors: 'Competitors',
  geos: 'Geo',
  budget: 'Budget',
  channels: 'Channels',
  creative: 'Creative',
  measurement: 'Measurement',
  deliverables: 'Deliverables',
  openQuestions: 'Open Q',
};

interface Props {
  supabase: SupabaseClient | null;
  sessionId: string | null;
  onClose: () => void;
}

export function BriefVersionsPopover({ supabase, sessionId, onClose }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase || !sessionId) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('cbw_brief_versions')
        .select('id, version_number, changed_sections, rationale, trigger_kind, created_at')
        .eq('session_id', sessionId)
        .order('version_number', { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows((data ?? []) as Row[]);
    })();
    return () => { cancelled = true; };
  }, [supabase, sessionId]);

  // Click-outside to close
  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(ev.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);

  return (
    <div className="cbw-history" ref={ref} role="dialog" aria-label="Version history">
      <div className="cbw-history__head">
        <h3>Version history</h3>
        <button className="cbw-history__close" type="button" onClick={onClose} aria-label="Close">×</button>
      </div>
      {error && <div className="cbw-history__error">{error}</div>}
      {!rows && !error && <div className="cbw-history__loading">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="cbw-history__empty">No versions yet — versions are committed when the strategist patches the brief.</div>
      )}
      {rows && rows.length > 0 && (
        <ul className="cbw-history__list">
          {rows.map((r) => (
            <li key={r.id} className="cbw-history__row">
              <div className="cbw-history__row-head">
                <span className="cbw-history__version">v0.{r.version_number}</span>
                <span className="cbw-history__when">{formatTime(r.created_at)}</span>
                {r.trigger_kind && (
                  <span className="cbw-history__kind">{r.trigger_kind}</span>
                )}
              </div>
              {r.changed_sections.length > 0 && (
                <div className="cbw-history__sections">
                  {r.changed_sections.map((s) => (
                    <span key={s}>{SECTION_LABEL[s as BriefSectionKey] || s}</span>
                  ))}
                </div>
              )}
              {r.rationale && <div className="cbw-history__rationale">{r.rationale}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
