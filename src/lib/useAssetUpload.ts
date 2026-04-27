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

  // ── Realtime subscription on canonical assets for the active session ────
  // The DS handler stamps session_id (text) on the canonical assets row,
  // so we filter on that. ingest-asset-background updates `meta.ingest_status`
  // and writes `meta.brief_skeleton` on completion.
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
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new;
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
                briefSkeleton: skeleton,
                ingestError: ingestError ?? a.ingestError,
              }
              : a)),
          }));
        },
      )
      .subscribe();
    return () => { (supabase as any).removeChannel?.(channel); };
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
