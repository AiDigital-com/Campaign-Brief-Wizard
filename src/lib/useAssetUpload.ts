/**
 * useAssetUpload — full-flow asset upload + ingest wiring for CBW.
 *
 * Per file dropped:
 *   1. POST /.netlify/functions/upload-asset → { assetId, signedUrl, storagePath }
 *   2. PUT the file body to signedUrl (Supabase storage handles the multipart)
 *   3. POST /.netlify/functions/ingest-asset-background → starts extraction
 *   4. Realtime subscription on cbw_assets keeps the UI fresh as the
 *      background function flips ingest_status: extracting → extracted | error
 *      and writes brief_skeleton.
 *
 * State is owned by the parent (App.tsx) via the `assets` array. This hook
 * mutates that array via the `onChange` callback.
 *
 * The Realtime subscription is keyed on `sessionId`; switching sessions
 * tears down the old channel and resubscribes.
 */
import { useEffect, useRef, useCallback } from 'react';
import type { SupabaseClient } from '@AiDigital-com/design-system';
import type { BriefAsset, AssetKind } from './types';

type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;

interface Options {
  supabase: SupabaseClient | null;
  authFetch: AuthFetch;
  sessionId: string | null;
  userId: string | null | undefined;
  /** Read-side: latest snapshot owned by App.tsx — used by Realtime to
   *  diff incoming row state against current UI state. */
  assetsRef: React.MutableRefObject<BriefAsset[]>;
  /** Setter — App.tsx funnels into setAssets. */
  onChange: (next: BriefAsset[] | ((prev: BriefAsset[]) => BriefAsset[])) => void;
}

interface UseAssetUploadReturn {
  uploadFiles: (files: File[]) => Promise<void>;
  removeAsset: (assetId: string) => Promise<void>;
}

const KIND_FROM_EXT: Record<string, AssetKind> = {
  pdf: 'pdf',
  doc: 'docx', docx: 'docx',
  ppt: 'pptx', pptx: 'pptx',
  xls: 'xlsx', xlsx: 'xlsx',
  csv: 'csv',
  md: 'md',
  txt: 'txt',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
};

function detectKind(file: File): AssetKind {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (KIND_FROM_EXT[ext]) return KIND_FROM_EXT[ext];
  if (file.type.startsWith('image/')) return 'image';
  return 'other';
}

function maps(skeleton: Record<string, unknown> | null | undefined): string[] {
  if (!skeleton) return [];
  const keys = Object.keys(skeleton).filter((k) => {
    const v = (skeleton as Record<string, unknown>)[k];
    return v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
  // Drop doc-meta keys; only count sections worth showing as pills.
  const sectionKeys = keys.filter(
    (k) => !['title', 'agency', 'client', 'industry', 'status'].includes(k),
  );
  const labels: Record<string, string> = {
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
  return sectionKeys.map((k) => labels[k] || `§ ${k}`);
}

function rowToAsset(row: Record<string, unknown>): BriefAsset {
  const skeleton = row.brief_skeleton as Record<string, unknown> | null;
  const ingest = String(row.ingest_status || 'pending');
  const state: BriefAsset['state'] =
    ingest === 'extracted' ? 'ready'
    : ingest === 'error' ? 'error'
    : ingest === 'extracting' ? 'extracting'
    : 'pending';
  const sectionMaps = maps(skeleton);
  return {
    id: String(row.id),
    name: String(row.name),
    kind: ((row.type as AssetKind) || 'other'),
    size: typeof row.size === 'number' ? row.size : undefined,
    storagePath: row.storage_path ? String(row.storage_path) : undefined,
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : undefined,
    state,
    progress: state === 'ready' ? 100 : undefined,
    hits: sectionMaps.length ? `${sectionMaps.length} section${sectionMaps.length === 1 ? '' : 's'} mapped` : undefined,
    maps: sectionMaps.length ? sectionMaps : undefined,
    ingestError: row.ingest_error ? String(row.ingest_error) : undefined,
    addedAt: String(row.created_at || new Date().toISOString()),
  };
}

export function useAssetUpload(opts: Options): UseAssetUploadReturn {
  const { supabase, authFetch, sessionId, userId, assetsRef, onChange } = opts;
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // ── Realtime subscription on cbw_assets for the active session ──────────
  useEffect(() => {
    if (!supabase || !sessionId) return;
    const channel = (supabase as any).channel(`cbw_assets:${sessionId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'cbw_assets',
        filter: `session_id=eq.${sessionId}`,
      }, (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
        if (payload.eventType === 'DELETE') {
          const oldId = String(payload.old?.id || '');
          if (!oldId) return;
          onChange((prev) => prev.filter((a) => a.id !== oldId));
          return;
        }
        const row = payload.new;
        if (!row?.id) return;
        const next = rowToAsset(row);
        onChange((prev) => {
          const idx = prev.findIndex((a) => a.id === next.id);
          // Preserve a local 'uploading' state if the realtime row is still
          // 'pending' — server-side ingest_status hasn't advanced past insert
          // until ingest-asset-background flips it to 'extracting'.
          if (idx === -1) return [...prev, next];
          const merged = { ...prev[idx], ...next };
          if (prev[idx].state === 'uploading' && next.state === 'pending') {
            merged.state = 'uploading';
          }
          return [...prev.slice(0, idx), merged, ...prev.slice(idx + 1)];
        });
      })
      .subscribe();
    return () => { (supabase as any).removeChannel?.(channel); };
  }, [supabase, sessionId, onChange]);

  const uploadFiles = useCallback(async (files: File[]) => {
    const sid = sessionIdRef.current;
    if (!sid) {
      console.warn('[cbw] uploadFiles: no sessionId yet');
      return;
    }

    for (const file of files) {
      const tempId = crypto.randomUUID();
      const kind = detectKind(file);
      const optimistic: BriefAsset = {
        id: tempId,
        name: file.name,
        kind,
        size: file.size,
        state: 'uploading',
        progress: 0,
        addedAt: new Date().toISOString(),
      };
      onChange((prev) => [...prev, optimistic]);

      try {
        // 1. Get signed upload URL
        const signRes = await authFetch('/.netlify/functions/upload-asset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: sid,
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            kind,
          }),
        });
        if (!signRes.ok) throw new Error(`upload-asset ${signRes.status}`);
        const { assetId, signedUrl } = await signRes.json();

        // Swap the optimistic temp row for the real DB row. We keep state
        // 'uploading' until the PUT completes — Realtime will deliver the
        // 'pending' row from the server but we override below.
        onChange((prev) => prev.map((a) => (a.id === tempId
          ? { ...a, id: assetId, state: 'uploading', progress: 30 }
          : a)));

        // 2. PUT to Supabase signed URL
        const putRes = await fetch(signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!putRes.ok) throw new Error(`storage PUT ${putRes.status}`);

        // 3. Trigger ingest. -background: returns 202 immediately.
        onChange((prev) => prev.map((a) => (a.id === assetId
          ? { ...a, state: 'extracting', progress: 70 }
          : a)));

        const ingestRes = await authFetch(
          '/.netlify/functions/ingest-asset-background',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sid, assetId, userId }),
          },
        );
        // Background functions return 202 Accepted; treat 200/202 as ok.
        if (!ingestRes.ok && ingestRes.status !== 202) {
          throw new Error(`ingest dispatch ${ingestRes.status}`);
        }
        // Realtime takes over from here — when ingest_status flips, the row
        // arrives with state: ready and the UI updates.
      } catch (err) {
        console.error('[cbw] upload failed:', err);
        onChange((prev) => prev.map((a) => (a.id === tempId || a.id === optimistic.id
          ? { ...a, state: 'error', ingestError: String(err).slice(0, 200) }
          : a)));
      }
    }
  }, [authFetch, onChange, userId]);

  const removeAsset = useCallback(async (assetId: string) => {
    if (!supabase) return;
    onChange((prev) => prev.filter((a) => a.id !== assetId));
    // Server-side row delete; Realtime DELETE will be a no-op (already gone).
    void assetsRef;
    await supabase.from('cbw_assets').delete().eq('id', assetId);
  }, [supabase, assetsRef, onChange]);

  return { uploadFiles, removeAsset };
}
