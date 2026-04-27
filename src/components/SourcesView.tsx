/**
 * SourcesView — Sources tab inside the BriefArtifact.
 *
 * Lists ready assets only (still-extracting ones are visible in the
 * AssetRail's progress chip, no need to duplicate). Each source shows the
 * colored file-type icon, hits/section maps, and a pulled quote when
 * available.
 */
import type { BriefAsset } from '../lib/types';

interface Props {
  assets: BriefAsset[];
}

export function SourcesView({ assets }: Props) {
  const ready = assets.filter((a) => a.state === 'ready');
  if (!ready.length) {
    return (
      <div className="cbw-sources cbw-sources--empty">
        Upload sources in the panel above — once extracted they'll appear here with the brief sections each one feeds.
      </div>
    );
  }
  return (
    <div className="cbw-sources">
      {ready.map((a) => (
        <div className="cbw-source" key={a.id}>
          <div className="cbw-source__icon" data-kind={a.kind}>
            {(a.name.split('.').pop() || a.kind).toUpperCase().slice(0, 4)}
          </div>
          <div>
            <div className="cbw-source__name">{a.name}</div>
            <div className="cbw-source__hits">
              {a.hits || 'extracted'}
              {a.pagesLabel ? ` · ${a.pagesLabel}` : ''}
            </div>
            {a.quote && <div className="cbw-source__quote">"{a.quote}"</div>}
            {a.maps && a.maps.length > 0 && (
              <div className="cbw-source__map">
                {a.maps.map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
