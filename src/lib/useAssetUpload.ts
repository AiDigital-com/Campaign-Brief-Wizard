/**
 * useAssetUpload — multi-asset upload state for CBW.
 *
 * Mirrors SFG's pattern (src/hooks/useAssetUpload.ts in Synthetic-Focus-Group)
 * with a CBW-specific addition: after the canonical `/upload-asset` endpoint
 * returns an assetId, we kick off `/ingest-asset-background` to extract a
 * brief skeleton. A Supabase Realtime subscription on the canonical `assets`
 * table flips each tile's state from extracting → ready when the background
 * function completes.
 *
 * Asset row lives in the canonical `assets` table (DS createUploadAssetHandler
 * via /upload-asset). Extraction state is stored on `assets.meta.ingest_status`
 * and `assets.meta.brief_skeleton`.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/react';
import type { SupabaseClient } from '@AiDigital-com/design-system';
import type { AssetState } from './types';

interface State {
  assets: AssetState[];
  error: string | null;
}

interface Options {
  supabase: SupabaseClient | null;
  sessionId: string | null;
}

export function useAssetUpload({ supabase, sessionId }: Options) {
  const { getToken } = useAuth();
  const [state, setState] = useState<State>({ assets: [], error: null });
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const uploading = state.assets.some((a) => a.uploading);

  // ── Sync helpers ────────────────────────────────────────────────────
  // Three layers keep the client in sync with the canonical assets table:
  //   1. Realtime postgres_changes (UPDATE) for the session's rows
  //   2. Polling fallback every 3s while any asset is still 'extracting'
  //      — covers missed Realtime events, publication gaps, etc.
  //   3. Load-on-mount fetch when the session changes — recovers from a
  //      page reload mid-extraction or a previously-stuck tile
  const applyRow = useCallback((row: Record<string, unknown>) => {
    if (!row?.id) return;
    const meta = (row.meta || {}) as Record<string, unknown>;
    const ingestStatus = (meta.ingest_status as string) || 'pending';
    const skeleton = meta.brief_skeleton as Record<string, unknown> | undefined;
    const ingestError = (meta.ingest_error as string) || null;
    setState((s) => ({
      ...s,
      assets: s.assets.map((a) => (a.assetId === row.id
        ? {
          ...a,
          ingestStatus: ingestStatus as AssetState['ingestStatus'],
          briefSkeleton: skeleton ?? a.briefSkeleton,
          ingestError: ingestError ?? a.ingestError,
        }
        : a)),
    }));
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!supabase || !sessionId) return;
    const channel = (supabase as any).channel(`cbw-assets:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'assets',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload: { new: Record<string, unknown> }) => applyRow(payload.new),
      )
      .subscribe();
    return () => { (supabase as any).removeChannel?.(channel); };
  }, [supabase, sessionId, applyRow]);

  // Polling fallback while anything is mid-extraction
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    if (!supabase) return;
    const interval = setInterval(async () => {
      const inflight = stateRef.current.assets.filter(
        (a) => a.assetId && (a.ingestStatus === 'extracting' || a.ingestStatus === 'pending'),
      );
      if (inflight.length === 0) return;
      const ids = inflight.map((a) => a.assetId!).filter(Boolean);
      const { data } = await supabase
        .from('assets')
        .select('id, meta')
        .in('id', ids);
      for (const row of data ?? []) applyRow(row as Record<string, unknown>);
    }, 3000);
    return () => clearInterval(interval);
  }, [supabase, applyRow]);

  // Load-on-mount: if a session has prior assets in the canonical table,
  // restore them so the tile grid reappears after page reload or session select.
  useEffect(() => {
    if (!supabase || !sessionId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('assets')
        .select('id, source_filename, source_mime_type, source_uri, meta')
        .eq('session_id', sessionId)
        .eq('created_by_app', 'campaign-brief-wizard')
        .order('created_at', { ascending: true });
      if (cancelled || !data) return;
      setState((s) => {
        const known = new Set(s.assets.map((a) => a.assetId).filter(Boolean));
        const restored: AssetState[] = (data as Array<Record<string, unknown>>)
          .filter((row) => !known.has(row.id as string))
          .map((row) => {
            const meta = (row.meta || {}) as Record<string, unknown>;
            return {
              id: crypto.randomUUID(),
              assetId: row.id as string,
              fileName: (row.source_filename as string | null) ?? '',
              mimeType: (row.source_mime_type as string | null) ?? '',
              previewUrl: null,
              supabaseAssetUrl: (row.source_uri as string | null) ?? undefined,
              uploading: false,
              ingestStatus: ((meta.ingest_status as string) || 'extracted') as AssetState['ingestStatus'],
              briefSkeleton: meta.brief_skeleton as Record<string, unknown> | undefined,
              ingestError: (meta.ingest_error as string) || null,
            };
          });
        return restored.length ? { ...s, assets: [...s.assets, ...restored] } : s;
      });
    })();
    return () => { cancelled = true; };
  }, [supabase, sessionId]);

  const uploadFile = useCallback(async (file: File): Promise<AssetState | null> => {
    const sid = sessionIdRef.current;
    const id = crypto.randomUUID();
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

    const pending: AssetState = {
      id,
      fileName: file.name,
      mimeType: file.type,
      previewUrl,
      uploading: true,
    };
    setState((s) => ({ ...s, assets: [...s.assets, pending], error: null }));

    const formData = new FormData();
    formData.append('file', file);
    if (sid) formData.append('session_id', sid);

    try {
      const token = await getToken();
      const res = await fetch('/.netlify/functions/upload-asset', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error ?? 'Upload failed';
        setState((s) => ({
          ...s,
          assets: s.assets.map((a) => (a.id === id ? { ...a, uploading: false, error: msg } : a)),
          error: msg,
        }));
        return null;
      }

      const completed: AssetState = {
        id,
        assetId: data.assetId,
        fileName: data.fileName ?? file.name,
        mimeType: data.mimeType ?? file.type,
        previewUrl,
        supabaseAssetUrl: data.supabaseUrl || undefined,
        uploading: false,
        ingestStatus: 'extracting',
      };
      setState((s) => ({
        ...s,
        assets: s.assets.map((a) => (a.id === id ? completed : a)),
      }));

      // Fire-and-forget: kick the background extractor. -background returns 202
      // immediately; the canonical assets Realtime subscription delivers the
      // final state once the function writes back meta.brief_skeleton.
      if (data.assetId) {
        fetch('/.netlify/functions/ingest-asset-background', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ assetId: data.assetId }),
        }).catch((err) => {
          console.warn('[cbw] ingest dispatch failed:', err);
        });
      }
      return completed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setState((s) => ({
        ...s,
        assets: s.assets.map((a) => (a.id === id ? { ...a, uploading: false, error: msg } : a)),
        error: msg,
      }));
      return null;
    }
  }, [getToken]);

  const uploadFiles = useCallback(async (files: File[]) => {
    for (const f of files) await uploadFile(f);
  }, [uploadFile]);

  const removeAsset = useCallback((id: string) => {
    setState((s) => {
      const target = s.assets.find((a) => a.id === id);
      if (target?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl);
      return { ...s, assets: s.assets.filter((a) => a.id !== id) };
    });
  }, []);

  const clearAll = useCallback(() => {
    setState((s) => {
      s.assets.forEach((a) => {
        if (a.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
      });
      return { assets: [], error: null };
    });
  }, []);

  return {
    assets: state.assets,
    uploading,
    error: state.error,
    uploadFile,
    uploadFiles,
    removeAsset,
    clearAll,
  };
}
