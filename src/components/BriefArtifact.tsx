/**
 * BriefArtifact — right pane.
 *
 * Header (title + version pill + live indicator) → tabs (Rendered / Markdown
 * / Sources) → body. Slice 8 wires the Updated overlay toggle, slice 9 the
 * export bar.
 *
 * Empty state: "the brief will appear here as we talk" — never placeholder
 * sections, never lorem-ipsum.
 */
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@AiDigital-com/design-system';
import type { Brief, AssetState, BriefSectionKey } from '../lib/types';
import { RenderedBrief } from './RenderedBrief';
import { MarkdownView } from './BriefMarkdown';
import { SourcesView } from './SourcesView';
import { BriefVersionsPopover } from './BriefVersionsPopover';
import { ExportBar } from './ExportBar';

type Tab = 'rendered' | 'markdown' | 'sources';
const TAB_STORAGE_KEY = 'cbw:artifactTab';

interface Props {
  brief: Brief | null;
  assets: AssetState[];
  changedSections?: BriefSectionKey[];
  versionNumber?: number;
  supabase?: SupabaseClient | null;
  sessionId?: string | null;
}

export function BriefArtifact({
  brief, assets, versionNumber, changedSections, supabase, sessionId,
}: Props) {
  const hasContent = brief && Object.keys(brief).filter((k) => k !== 'lastUpdatedAt').length > 0;

  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'rendered';
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY) as Tab | null;
    return saved === 'markdown' || saved === 'sources' || saved === 'rendered' ? saved : 'rendered';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);

  const [showUpdates, setShowUpdates] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const updatedCount = changedSections?.length ?? 0;

  if (!hasContent && assets.length === 0) {
    return (
      <div className="cbw-brief cbw-brief--empty">
        <div className="cbw-brief__empty-hint">
          The brief will appear here as we talk.
        </div>
      </div>
    );
  }

  const readyCount = assets.filter((a) => a.ingestStatus === 'extracted').length;

  return (
    <div className="cbw-brief">
      <div className="cbw-brief__head">
        <div className="cbw-brief__head-left">
          <h2 className="cbw-brief__title-tag">Media brief</h2>
          {versionNumber != null && (
            <button
              type="button"
              className="cbw-brief__version cbw-brief__version--btn"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              title="Version history"
            >v0.{versionNumber}</button>
          )}
          {hasContent && (
            <span className="cbw-brief__live">
              <span className="dot" aria-hidden />
              Live
            </span>
          )}
        </div>
        <div className="cbw-brief__head-right">
          {hasContent && (
            <button
              type="button"
              className={`cbw-upd-toggle${showUpdates ? ' on' : ''}`}
              onClick={() => setShowUpdates((v) => !v)}
              title="Highlight sections changed in the latest pass"
            >
              <span className="cbw-upd-toggle__dot" aria-hidden />
              Updated
              <span className="cbw-upd-toggle__count">{updatedCount}</span>
            </button>
          )}
        </div>
        {historyOpen && (
          <BriefVersionsPopover
            supabase={supabase ?? null}
            sessionId={sessionId ?? null}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>
      <div className="cbw-brief__tabs">
        <button
          type="button"
          className={`cbw-brief__tab${tab === 'rendered' ? ' active' : ''}`}
          onClick={() => setTab('rendered')}
        >
          ◧ Rendered
        </button>
        <button
          type="button"
          className={`cbw-brief__tab${tab === 'markdown' ? ' active' : ''}`}
          onClick={() => setTab('markdown')}
        >
          {'<>'} Markdown
        </button>
        <button
          type="button"
          className={`cbw-brief__tab${tab === 'sources' ? ' active' : ''}`}
          onClick={() => setTab('sources')}
        >
          ⛭ Sources <span className="cbw-brief__tab-count">· {readyCount}</span>
        </button>
      </div>
      <div className="cbw-brief__body">
        {tab === 'rendered' && hasContent && (
          <RenderedBrief
            brief={brief!}
            changedSections={changedSections}
            showUpdates={showUpdates}
          />
        )}
        {tab === 'rendered' && !hasContent && (
          <div className="cbw-brief__empty-hint">
            Send a message — once we have evidence, the brief will fill in here.
          </div>
        )}
        {tab === 'markdown' && hasContent && <MarkdownView brief={brief!} />}
        {tab === 'markdown' && !hasContent && (
          <div className="cbw-brief__empty-hint">No brief content yet.</div>
        )}
        {tab === 'sources' && <SourcesView assets={assets} />}
      </div>
      <ExportBar brief={brief} tab={tab} />
    </div>
  );
}
