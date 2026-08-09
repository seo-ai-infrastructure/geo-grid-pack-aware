import { createClient } from '@supabase/supabase-js';

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://mvihrrewqzvqpsufzeid.supabase.co';
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
export const VIDEO_BUCKET = process.env.VIDEO_STORAGE_BUCKET || 'geogrid-videos';

const sb = () => createClient(supabaseUrl(), supabaseKey(), { auth: { persistSession: false } });

export function storageObjectPath(scanId, label) {
  return `${scanId}/${label}.mp4`;
}

export async function createSignedUploadUrl(scanId, label) {
  const objectPath = storageObjectPath(scanId, label);
  const storage = sb().storage.from(VIDEO_BUCKET);
  // Allow re-upload when a point is retried (createSignedUploadUrl fails if object exists).
  let { data, error } = await storage.createSignedUploadUrl(objectPath, { upsert: true });
  if (error && /already exists/i.test(error.message)) {
    await storage.remove([objectPath]).catch(() => {});
    ({ data, error } = await storage.createSignedUploadUrl(objectPath, { upsert: true }));
  }
  if (error) throw new Error(`signed upload url: ${error.message}`);
  return { bucket: VIDEO_BUCKET, objectPath, signedUrl: data.signedUrl, token: data.token };
}

export function publicVideoUrl(bucket, objectPath) {
  return `${supabaseUrl()}/storage/v1/object/public/${bucket}/${objectPath}`;
}
