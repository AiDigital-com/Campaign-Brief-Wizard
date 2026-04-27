/**
 * SourcesView — Sources tab inside the BriefArtifact.
 *
 * Lists assets whose ingest pipeline reached `extracted` (still-extracting
 * ones are visible in the AssetRail tile grid above). Each card shows the
 * filename, the brief sections the skeleton covers, and the file URL.
 */
import type { AssetState, BriefSectionKey } from '../lib/types';

interface Props {
  assets: AssetState[];
}

const SECTION_LABEL: Record<BriefSectionKey, string> = {
  submission: '§ Submission',
  background: '§ Background',
  goals: '§ Goals',
  kpis: '§ KPIs',
  audience: '§ Audience',
  competitors: '§ Competitors',
  geos: '§ Geo',
  budget: '§ Budget',
  channels: '§ Channels',
  creative: '§ Creative',
  measurement: '§ Measurement',
  deliverables: '§ Deliverables',
  openQuestions: '§ Open Q',
};

function detectKindFromMime(mime?: string): string {
  if (!mime) return 'other';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('wordprocessingml')) return 'docx';
  if (mime.includes('presentationml')) return 'pptx';
  if (mime.includes('spreadsheetml')) return 'xlsx';
  if (mime === 'text/csv') return 'csv';
  if (mime === 'text/markdown') return 'md';
  if (mime === 'text/plain') return 'txt';
  if (mime.startsWith('image/')) return 'image';
  return 'other';
}

function mapsFromSkeleton(s?: Record<string, unknown>): BriefSectionKey[] {
  if (!s) return [];
  const sectionKeys: BriefSectionKey[] = [
    'submission', 'background', 'goals', 'kpis', 'audience', 'competitors',
    'geos', 'budget', 'channels', 'creative', 'measurement', 'deliverables', 'openQuestions',
  ];
  return sectionKeys.filter((k) => {
    const v = s[k];
    if (v == null || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) return false;
    return true;
  });
}

export function SourcesView({ assets }: Props) {
  const ready = assets.filter((a) => a.ingestStatus === 'extracted');
  if (!ready.length) {
    return (
      <div className="cbw-sources cbw-sources--empty">
        Upload sources in the panel above — once extracted they'll appear here with the brief sections each one feeds.
      </div>
    );
  }
  return (
    <div className="cbw-sources">
      {ready.map((a) => {
        const kind = detectKindFromMime(a.mimeType);
        const maps = mapsFromSkeleton(a.briefSkeleton);
        return (
          <div className="cbw-source" key={a.id}>
            <div className="cbw-source__icon" data-kind={kind}>
              {((a.fileName || '').split('.').pop() || kind).toUpperCase().slice(0, 4)}
            </div>
            <div>
              <div className="cbw-source__name">{a.fileName ?? '(untitled)'}</div>
              <div className="cbw-source__hits">
                {maps.length ? `${maps.length} section${maps.length === 1 ? '' : 's'} mapped` : 'extracted'}
              </div>
              {maps.length > 0 && (
                <div className="cbw-source__map">
                  {maps.map((m) => (
                    <span key={m}>{SECTION_LABEL[m]}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
