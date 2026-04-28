/**
 * AssetRail — top-center pane.
 *
 * Thin wrapper around the DS `<UploadZone>` in multi mode. UploadZone owns
 * the dropzone AND the tile grid (we feed it `assets` + `onRemove`); we
 * paint a small "Extracting…" status row over the tiles via CSS for the
 * post-upload / pre-extracted phase, since UploadZone's built-in
 * `uploading` slot only covers the actual POST window.
 *
 * Phase mapping:
 *   server POST in flight       → UploadZone "Uploading…" badge
 *   server returned, ingest mid → custom "Extracting…" pill (below name)
 *   ingest done (extracted)     → clean tile, no badge
 *   error                       → UploadZone error tile
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
  const extracting = assets.filter((a) => a.ingestStatus === 'extracting');

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
          // UploadZone's "Uploading…" overlay only during the actual POST.
          // Extraction phase is signalled separately below.
          uploading: Boolean(a.uploading),
          error: a.error ?? a.ingestError ?? null,
        }))}
      />

      {extracting.length > 0 && (
        <div className="cbw-assets__extracting">
          <span className="cbw-assets__extracting-dot" aria-hidden />
          {extracting.length === 1
            ? `Extracting ${extracting[0].fileName ?? 'source'}…`
            : `Extracting ${extracting.length} sources…`}
        </div>
      )}
    </div>
  );
}
