/**
 * BriefArtifact — right pane.
 *
 * Header (title + version pill + live indicator) → tabs (Rendered / Markdown
 * / Sources, slice 7) → body. Slice 6 ships the Rendered view; Markdown +
 * Sources tabs land in slice 7, the Updated overlay toggle in slice 8, the
 * export bar in slice 9.
 *
 * Empty state: "the brief will appear here as we talk" — never placeholder
 * sections, never lorem-ipsum.
 */
import type { Brief, BriefSectionKey } from '../lib/types';
import { RenderedBrief } from './RenderedBrief';

interface Props {
  brief: Brief | null;
  changedSections?: BriefSectionKey[];
  versionNumber?: number;
}

export function BriefArtifact({ brief, versionNumber, changedSections }: Props) {
  const hasContent = brief && Object.keys(brief).filter((k) => k !== 'lastUpdatedAt').length > 0;

  if (!hasContent) {
    return (
      <div className="cbw-brief cbw-brief--empty">
        <div className="cbw-brief__empty-hint">
          The brief will appear here as we talk.
        </div>
      </div>
    );
  }

  return (
    <div className="cbw-brief">
      <div className="cbw-brief__head">
        <div className="cbw-brief__head-left">
          <h2 className="cbw-brief__title-tag">Media brief</h2>
          {versionNumber != null && (
            <span className="cbw-brief__version">v0.{versionNumber}</span>
          )}
          <span className="cbw-brief__live">
            <span className="dot" aria-hidden />
            Live
          </span>
        </div>
      </div>
      <div className="cbw-brief__body">
        <RenderedBrief brief={brief!} changedSections={changedSections} />
      </div>
    </div>
  );
}
