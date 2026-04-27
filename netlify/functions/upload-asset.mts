/**
 * upload-asset — thin wrapper around the DS asset-upload handler.
 *
 * Mirrors SFG's pattern (`createUploadAssetHandler({ app: 'sfg' })`). The
 * DS handler:
 *   - Auth via Clerk (requireAuth)
 *   - Reads { file, session_id } from FormData
 *   - Validates MIME + size
 *   - Uploads to Supabase Storage (Gemini Files API skipped — we don't
 *     need it; extraction goes through extractDocumentText)
 *   - Calls `create_asset` RPC under service role with userId derived from
 *     the JWT, creating a row in the canonical `assets` table
 *
 * Returns: { assetId, fileUri, mimeType, fileName, supabaseUrl }
 *
 * Extraction (extracted_text + meta.brief_skeleton) is dispatched separately
 * by the client via /.netlify/functions/ingest-asset-background after this
 * call returns the assetId.
 */
import { createUploadAssetHandler } from '@AiDigital-com/design-system/server';

export default createUploadAssetHandler({
  app: 'campaign-brief-wizard',
  bucket: 'cbw-assets',
  // Source materials for a media brief: PDFs, Word, PowerPoint, plain text,
  // markdown, plus images for brand/creative reference.
  allowedTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ],
  maxSizeBytes: 25 * 1024 * 1024,
  uploadToGemini: false,
} as Parameters<typeof createUploadAssetHandler>[0]);
