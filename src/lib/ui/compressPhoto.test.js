import { describe, expect, it } from 'vitest';
import { asJpegName, compressPhoto, scaledSize } from './compressPhoto.js';

describe('scaledSize', () => {
  it('fits the long side inside the limit and keeps the aspect ratio', () => {
    expect(scaledSize(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 1536, height: 2048 });
  });
  it('never enlarges a small photo', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('asJpegName', () => {
  it('swaps the extension for .jpg', () => {
    expect(asJpegName('IMG_1234.HEIC')).toBe('IMG_1234.jpg');
    expect(asJpegName('robot.photo.webp')).toBe('robot.photo.jpg');
    expect(asJpegName('noext')).toBe('noext.jpg');
    expect(asJpegName('')).toBe('photo.jpg');
  });
});

describe('compressPhoto', () => {
  it('returns the original file when it cannot or should not be re-encoded', async () => {
    const png = { type: 'image/png', name: 'a.png', size: 9e6 };
    expect(await compressPhoto(png)).toBe(png);
    expect(await compressPhoto(null)).toBe(null);
    // No createImageBitmap outside a browser: the photo is uploaded as it is.
    const jpeg = { type: 'image/jpeg', name: 'a.jpg', size: 9e6 };
    expect(await compressPhoto(jpeg)).toBe(jpeg);
  });
});
