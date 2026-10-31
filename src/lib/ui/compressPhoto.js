// Shrinks a phone photo before it is uploaded to Storage. Pit and start-position photos are shown many times on
// many phones, and every download counts toward the Supabase organization's egress quota; a full-resolution phone
// photo is 3-5 MB, while 2048 px on the long side is still more detail than any page here shows. The original is
// uploaded unchanged whenever shrinking is not possible or would not make it smaller (an undecodable format, a
// PNG that may carry transparency, a photo that is already small).

export const MAX_PHOTO_SIDE = 2048;
export const PHOTO_QUALITY = 0.85;
const COMPRESSIBLE = /^image\/(jpeg|jpg|webp|heic|heif)$/i;

/** The size that fits inside max x max, keeping the aspect ratio and never enlarging. */
export function scaledSize(width, height, max = MAX_PHOTO_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** The file name with its extension changed to .jpg (for a photo re-encoded as JPEG). */
export function asJpegName(name) {
  const base = String(name || 'photo').replace(/\.[^./\\]+$/, '');
  return `${base || 'photo'}.jpg`;
}

/** Returns a smaller JPEG File, or the original file when that is not possible or not smaller. */
export async function compressPhoto(file, { max = MAX_PHOTO_SIDE, quality = PHOTO_QUALITY } = {}) {
  if (!file || !COMPRESSIBLE.test(file.type || '') || typeof createImageBitmap !== 'function') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = scaledSize(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.type !== 'image/jpeg' || blob.size >= file.size) return file;
    return new File([blob], asJpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
