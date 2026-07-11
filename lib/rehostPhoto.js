/**
 * 사진 재호스팅 공통 로직 — api/cache-photo.ts와 api/backfill-photos.ts가 공유
 */

const BUCKET = 'place-photos';

export interface RehostResult {
  url: string;
  cached: boolean;
  sizeBytes?: number;
}

/**
 * Google Place Photo URL을 Supabase Storage로 재호스팅.
 * 이미 업로드돼 있으면 재다운로드 없이 바로 기존 공개 URL을 반환.
 */
export async function rehostGooglePhoto(
  supabase: any,
  photoUrl: string,
  placeId: string,
  serverMapsKey: string
): Promise<RehostResult> {
  const path = 'places/' + placeId + '.jpg';

  const { data: existing } = await supabase.storage.from(BUCKET).list('places', {
    search: placeId + '.jpg',
  });
  if (existing && existing.length > 0) {
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl, cached: true };
  }

  const urlObj = new URL(photoUrl);
  urlObj.searchParams.set('key', serverMapsKey);
  const fetchUrl = urlObj.toString();

  const imgRes = await fetch(fetchUrl);
  if (!imgRes.ok) {
    throw new Error('사진 다운로드 실패 (' + imgRes.status + ')');
  }

  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await imgRes.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true, cacheControl: '2592000' });

  if (uploadError) {
    throw new Error('Storage 업로드 실패: ' + uploadError.message);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl, cached: false, sizeBytes: bytes.byteLength };
}
