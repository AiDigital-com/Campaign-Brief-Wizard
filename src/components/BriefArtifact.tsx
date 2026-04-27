/**
 * BriefArtifact — right pane. Stub for slice 2.
 *
 * The full 13-section RenderedBrief lands in slice 6. For now this just
 * shows the empty hint or a JSON preview of patched data so wiring slices
 * 4-5 can be verified end-to-end.
 *
 * NEVER renders placeholder copy — empty fields = nothing on screen.
 */
import type { Brief, BriefSectionKey } from '../lib/types';

interface Props {
  brief: Brief | null;
  changedSections?: BriefSectionKey[];
  versionNumber?: number;
}

export function BriefArtifact({ brief, versionNumber }: Props) {
  const isEmpty = !brief || Object.keys(brief).filter((k) => k !== 'lastUpdatedAt').length === 0;

  if (isEmpty) {
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
      <div className="cbw-brief__header">
        {brief?.title && <h1 className="cbw-brief__title">{brief.title}</h1>}
        {versionNumber != null && (
          <span className="cbw-brief__version">v0.{versionNumber}</span>
        )}
      </div>
      <pre className="cbw-brief__preview">{JSON.stringify(brief, null, 2)}</pre>
    </div>
  );
}
