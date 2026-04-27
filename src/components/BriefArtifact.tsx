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
import type { Brief, BriefAsset, BriefSectionKey } from '../lib/types';
import { RenderedBrief } from './RenderedBrief';
import { MarkdownView } from './BriefMarkdown';
import { SourcesView } from './SourcesView';

type Tab = 'rendered' | 'markdown' | 'sources';
const TAB_STORAGE_KEY = 'cbw:artifactTab';

interface Props {
  brief: Brief | null;
  assets: BriefAsset[];
  changedSections?: BriefSectionKey[];
  versionNumber?: number;
}

export function BriefArtifact({ brief, assets, versionNumber, changedSections }: Props) {
  const hasContent = brief && Object.keys(brief).filter((k) => k !== 'lastUpdatedAt').length > 0;

  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'rendered';
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY) as Tab | null;
    return saved === 'markdown' || saved === 'sources' || saved === 'rendered' ? saved : 'rendered';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);

  if (!hasContent && assets.length === 0) {
    return (
      <div className="cbw-brief cbw-brief--empty">
        <div className="cbw-brief__empty-hint">
          The brief will appear here as we talk.
        </div>
      </div>
    );
  }

  const readyCount = assets.filter((a) => a.state === 'ready').length;

  return (
    <div className="cbw-brief">
      <div className="cbw-brief__head">
        <div className="cbw-brief__head-left">
          <h2 className="cbw-brief__title-tag">Media brief</h2>
          {versionNumber != null && (
            <span className="cbw-brief__version">v0.{versionNumber}</span>
          )}
          {hasContent && (
            <span className="cbw-brief__live">
              <span className="dot" aria-hidden />
              Live
            </span>
          )}
        </div>
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
          <RenderedBrief brief={brief!} changedSections={changedSections} />
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
    </div>
  );
}
