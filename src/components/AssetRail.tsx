/**
 * AssetRail — top-center pane (per design handoff).
 *
 * Slice 2 stub: surface only. Real upload + ingest wiring lands in slice 4
 * (uploads to cbw-assets bucket via signed URL, inserts cbw_assets row,
 * triggers ingest-asset-background, polls extraction status).
 */
import { UploadZone } from '@AiDigital-com/design-system';
import type { BriefAsset, AssetKind } from '../lib/types';

const MAX_ASSETS = 10;

const ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.csv,.md,.txt,.png,.jpg,.jpeg,.webp';

interface Props {
  assets: BriefAsset[];
  onChange: (next: BriefAsset[]) => void;
}

export function AssetRail({ assets, onChange }: Props) {
  function handleFiles(files: File[]) {
    const next = [...assets];
    for (const f of files) {
      if (next.length >= MAX_ASSETS) break;
      next.push({
        id: crypto.randomUUID(),
        name: f.name,
        kind: detectKind(f),
        size: f.size,
        state: 'pending',
        addedAt: new Date().toISOString(),
      });
    }
    onChange(next);
  }

  function handleRemove(id: string) {
    onChange(assets.filter((a) => a.id !== id));
  }

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
        maxFiles={MAX_ASSETS - assets.length}
        onFile={(f) => handleFiles([f])}
        onFiles={handleFiles}
        onUrl={() => { /* slice 4: ingest URL as an asset */ }}
        onClear={() => onChange([])}
        accept={ACCEPT}
      />

      {assets.length > 0 && (
        <ul className="cbw-assets__grid">
          {assets.map((a) => (
            <li key={a.id} className="cbw-asset" data-state={a.state} data-kind={a.kind}>
              <div className="cbw-asset__icon">
                {(a.name.split('.').pop() || a.kind).toUpperCase().slice(0, 4)}
              </div>
              <div className="cbw-asset__meta">
                <div className="cbw-asset__name" title={a.name}>{a.name}</div>
                <div className="cbw-asset__sub">
                  {formatSize(a.size)}
                  {a.pagesLabel && <> · {a.pagesLabel}</>}
                </div>
                {a.state !== 'ready' && a.state !== 'error' && (
                  <div className="cbw-asset__progress">
                    <i style={{ width: `${a.progress ?? 0}%` }} />
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
                onClick={() => handleRemove(a.id)}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function detectKind(f: File): AssetKind {
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx') || n.endsWith('.doc')) return 'docx';
  if (n.endsWith('.pptx') || n.endsWith('.ppt')) return 'pptx';
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'xlsx';
  if (n.endsWith('.csv')) return 'csv';
  if (n.endsWith('.md')) return 'md';
  if (n.endsWith('.txt')) return 'txt';
  if (f.type.startsWith('image/')) return 'image';
  return 'other';
}

function formatSize(bytes?: number): string {
  if (bytes == null) return 'web';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
