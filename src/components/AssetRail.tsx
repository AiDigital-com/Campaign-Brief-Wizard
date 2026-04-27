/**
 * AssetRail — top-center pane.
 *
 * Thin wrapper around the DS `<UploadZone>` in multi mode. UploadZone owns
 * both the dropzone AND the tile grid (we feed it `assets` + `onRemove`),
 * so there's no duplicate custom grid here. Mirrors the way SFG composes
 * UploadZone inside its ChatPanel inputPrefix.
 */
import { UploadZone } from '@AiDigital-com/design-system';
import type { AssetState } from '../lib/types';

const MAX_ASSETS = 10;
const ACCEPT = '.pdf,.docx,.pptx,.csv,.md,.txt,.png,.jpg,.jpeg,.webp';

interface Props {
  assets: AssetState[];
  onUpload: (files: File[]) => void | Promise<void>;
  onRemove: (id: string) => void;
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
        onUrl={() => { /* slice 11.1: ingest URL as an asset */ }}
        onClear={() => { /* per-tile remove handles cleanup */ }}
        onRemove={onRemove}
        accept={ACCEPT}
        assets={assets.map((a) => ({
          id: a.id,
          previewUrl: a.previewUrl ?? null,
          fileName: a.fileName ?? null,
          uploading: Boolean(a.uploading) || a.ingestStatus === 'extracting',
          error: a.error ?? a.ingestError ?? null,
        }))}
      />
    </div>
  );
}
