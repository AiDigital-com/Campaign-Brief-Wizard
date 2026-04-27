/**
 * upload-asset — issues a signed Supabase storage upload URL for a CBW asset.
 *
 * Flow:
 *   1. Client POSTs { sessionId, name, type, size, kind } here
 *   2. We insert a row into cbw_assets (state derived from `pending`/`uploading`)
 *   3. We create a signed upload URL on bucket `cbw-assets`
 *   4. Client PUTs the file directly to that URL
 *   5. Client POSTs to /.netlify/functions/ingest-asset-background to start
 *      text extraction + brief skeleton generation
 *
 * Path convention: `{userId}/{sessionId}/{assetId}/{filename}` — userId is
 * always set so RLS policies can be tightened later if we ever expose the
 * bucket directly to authenticated clients.
 */
import { createClient } from '@supabase/supabase-js';
import { requireAuthOrEmbed } from './_shared/auth.js';
import { log } from './_shared/logger.js';

const APP_NAME = 'campaign-brief-wizard';
const BUCKET = 'cbw-assets';
const SIGNED_UPLOAD_TTL_SECONDS = 60 * 5;
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per asset — well above typical RFP/deck

// Whitelist mirrors AssetKind in src/lib/types.ts
const ALLOWED_KINDS = new Set([
  'pdf', 'docx', 'pptx', 'xlsx', 'csv', 'image', 'url', 'md', 'txt', 'other',
]);

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let userId: string;
  try {
    const auth = await requireAuthOrEmbed(req);
    userId = auth.userId;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { sessionId, name, type, size, kind } = body as {
    sessionId?: string;
    name?: string;
    type?: string;
    size?: number;
    kind?: string;
  };

  if (!sessionId || !name) {
    return Response.json({ error: 'sessionId and name are required' }, { status: 400 });
  }
  if (typeof size === 'number' && size > MAX_BYTES) {
    return Response.json({ error: `File exceeds ${MAX_BYTES} bytes` }, { status: 413 });
  }
  const safeKind = kind && ALLOWED_KINDS.has(kind) ? kind : 'other';

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // The cbw_sessions row may not exist yet — useSessionPersistence creates
  // it lazily on first message. The cbw_assets.session_id FK was dropped
  // for exactly this reason; we only need user-ownership verification.
  // If a session row DOES exist, ensure the requester owns it.
  const { data: sess } = await supabase
    .from('cbw_sessions')
    .select('user_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (sess && sess.user_id !== userId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 200);
  const assetId = crypto.randomUUID();
  const storagePath = `${userId}/${sessionId}/${assetId}/${safeName}`;

  // Insert the asset row first (state=pending). Even if upload fails the row
  // documents the attempt — the UI can show 'error' state and let the user retry.
  const { error: insErr } = await supabase.from('cbw_assets').insert({
    id: assetId,
    session_id: sessionId,
    user_id: userId,
    name,
    type: safeKind,
    size: size ?? null,
    storage_path: storagePath,
    ingest_status: 'pending',
  });
  if (insErr) {
    log.error('upload-asset.insert_failed', {
      function_name: 'upload-asset',
      user_id: userId,
      meta: { sessionId, error: insErr.message },
    });
    return Response.json({ error: 'Could not register asset' }, { status: 500 });
  }

  // Issue the signed upload URL. expiresIn is the TTL for this PUT only.
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    log.error('upload-asset.sign_failed', {
      function_name: 'upload-asset',
      entity_id: assetId,
      user_id: userId,
      meta: { storagePath, error: signErr?.message },
    });
    // Clean up the orphan row
    await supabase.from('cbw_assets').delete().eq('id', assetId);
    return Response.json({ error: 'Could not sign upload URL' }, { status: 500 });
  }

  log.info('upload-asset.signed', {
    function_name: 'upload-asset',
    entity_id: assetId,
    user_id: userId,
    meta: { sessionId, name: safeName, kind: safeKind, size: size ?? 0 },
  });

  void type; // accepted for forward-compat (MIME); not stored separately for now
  void SIGNED_UPLOAD_TTL_SECONDS;

  return Response.json({
    ok: true,
    app: APP_NAME,
    assetId,
    storagePath,
    signedUrl: signed.signedUrl,
    token: signed.token,
  });
};
