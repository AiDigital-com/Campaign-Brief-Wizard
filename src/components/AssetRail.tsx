/**
 * AssetRail — top-center pane.
 *
 * Multi-file dropzone + grid of asset cards. Upload + ingest is owned by
 * useAssetUpload (App.tsx wires it). This component is presentational —
 * `onUpload(files)` triggers the hook, `onRemove(id)` removes a single
 * asset, and the assets array drives the card states.
 */
import { UploadZone } from '@AiDigital-com/design-system';
import type { BriefAsset } from '../lib/types';

const MAX_ASSETS = 10;
const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.csv,.md,.txt,.png,.jpg,.jpeg,.webp';

interface Props {
  assets: BriefAsset[];
  onUpload: (files: File[]) => void | Promise<void>;
  onRemove: (assetId: string) => void | Promise<void>;
}

export function AssetRail({ assets, onUpload, onRemove }: Props) {
  const remaining = MAX_ASSETS - assets.length;

  return (
    <div className="cbw-assets">
      <div className="cbw-assets__header">
        <h2 className="cbw-assets__title">Source materials</h2>
        <span className="cbw-assets__count">
          {assets.length} / {MAX_ASSETS}
        </span>
      </div>

      <UploadZone
        multiple
        maxFiles={Math.max(remaining, 0)}
        onFile={(f) => onUpload([f])}
        onFiles={(files) => onUpload(files)}
        onUrl={() => { /* slice 4.5: ingest URL as an asset */ }}
        onClear={() => { /* clearing the dropzone preview is a no-op here */ }}
        accept={ACCEPT}
      />

      {assets.length > 0 && (
        <ul className="cbw-assets__grid">
          {assets.map((a) => (
            <li
              key={a.id}
              className="cbw-asset"
              data-state={a.state}
              data-kind={a.kind}
            >
              <div className="cbw-asset__icon">
                {(a.name.split('.').pop() || a.kind).toUpperCase().slice(0, 4)}
              </div>
              <div className="cbw-asset__meta">
                <div className="cbw-asset__name" title={a.name}>{a.name}</div>
                <div className="cbw-asset__sub">
                  {formatSize(a.size)}
                  {a.pagesLabel && <> · {a.pagesLabel}</>}
                  {a.hits && <> · {a.hits}</>}
                </div>
                {a.state !== 'ready' && a.state !== 'error' && (
                  <div className="cbw-asset__progress">
                    <i style={{ width: `${a.progress ?? progressFor(a.state)}%` }} />
                  </div>
                )}
                {a.state === 'error' && a.ingestError && (
                  <div className="cbw-asset__error">{a.ingestError}</div>
                )}
                {a.maps && a.maps.length > 0 && (
                  <div className="cbw-asset__maps">
                    {a.maps.map((m, i) => (
                      <span key={i}>{m}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="cbw-asset__remove"
                aria-label={`Remove ${a.name}`}
                onClick={() => onRemove(a.id)}
                type="button"
              >×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatSize(bytes?: number): string {
  if (bytes == null) return 'web';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function progressFor(state: BriefAsset['state']): number {
  if (state === 'pending') return 5;
  if (state === 'uploading') return 35;
  if (state === 'extracting') return 75;
  return 0;
}
