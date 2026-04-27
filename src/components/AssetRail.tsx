/**
 * AssetRail — left pane. Multi-file ingestor for the brief.
 *
 * Wraps DS UploadZone in `multiple` mode (capped at 10 docs per session for
 * sane LLM context), tracks upload progress per asset, exposes remove.
 *
 * The actual upload + thumbnail logic is delegated to the parallel-thread
 * implementation (a useAssetUpload hook); this component is the surface.
 */
import { useState } from 'react';
import { UploadZone } from '@AiDigital-com/design-system';
import type { BriefAsset } from '../lib/types';

const MAX_ASSETS = 10;

interface Props {
  assets: BriefAsset[];
  onChange: (next: BriefAsset[]) => void;
}

export function AssetRail({ assets, onChange }: Props) {
  const [dragOver, setDragOver] = useState(false);
  void dragOver;

  // TODO (parallel thread): wire useAssetUpload hook that handles:
  //   - upload to Supabase storage bucket `cbw-assets`
  //   - thumbnail generation (PDF first-page, image)
  //   - server-side text extraction trigger (POST to ingest-asset-background)
  //   - per-asset progress + error states
  function handleFiles(files: File[]) {
    const next = [...assets];
    for (const f of files) {
      if (next.length >= MAX_ASSETS) break;
      next.push({
        id: crypto.randomUUID(),
        name: f.name,
        type: coarseType(f),
        size: f.size,
        addedAt: new Date().toISOString(),
        ingestStatus: 'pending',
      });
    }
    onChange(next);
  }

  function handleRemove(id: string) {
    onChange(assets.filter(a => a.id !== id));
  }

  return (
    <div className="cbw-assets">
      <div className="cbw-assets__header">
        <h2 className="cbw-assets__title">Source material</h2>
        <span className="cbw-assets__count">{assets.length} / {MAX_ASSETS}</span>
      </div>

      <UploadZone
        multiple
        maxFiles={MAX_ASSETS - assets.length}
        onFiles={handleFiles}
        accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
        onDragStateChange={setDragOver}
      />

      {assets.length === 0 ? (
        <div className="cbw-assets__empty">
          Drop research, transcripts, prior briefs, screenshots, or competitor
          decks. We'll extract what's relevant as you upload.
        </div>
      ) : (
        <ul className="cbw-assets__list">
          {assets.map((a) => (
            <li key={a.id} className="cbw-asset" data-status={a.ingestStatus}>
              {a.thumbnailUrl ? (
                <img className="cbw-asset__thumb" src={a.thumbnailUrl} alt="" />
              ) : (
                <div className="cbw-asset__thumb cbw-asset__thumb--placeholder">
                  {a.type.toUpperCase().slice(0, 3)}
                </div>
              )}
              <div className="cbw-asset__meta">
                <span className="cbw-asset__name" title={a.name}>{a.name}</span>
                <span className="cbw-asset__sub">
                  {formatSize(a.size)}
                  {a.ingestStatus && a.ingestStatus !== 'extracted' && (
                    <> · <em>{a.ingestStatus}</em></>
                  )}
                </span>
              </div>
              <button
                className="cbw-asset__remove"
                aria-label={`Remove ${a.name}`}
                onClick={() => handleRemove(a.id)}
                type="button"
              >×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function coarseType(f: File): string {
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx') || n.endsWith('.doc')) return 'docx';
  if (n.endsWith('.txt') || n.endsWith('.md')) return 'text';
  if (f.type.startsWith('image/')) return 'image';
  return 'other';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
