import { InjectionToken } from '@angular/core';

/** The long side of a photo once reduced on the phone (architecture §7: ~800 px). */
export const PHOTO_LONG_SIDE = 800;

/** The size a photo is drawn at: its long side brought down to `longSide`, never enlarged, proportions kept. */
export function reducedSize(width: number, height: number, longSide = PHOTO_LONG_SIDE): { readonly width: number; readonly height: number } {
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Reduces a photo taken by the camera to a JPEG of ~800 px, on the phone: what is kept and sent. Rejects when the file cannot be read as an image. */
export type PhotoReducer = (file: Blob) => Promise<Uint8Array>;

/** The browser's way: decode, draw smaller on a canvas, encode as JPEG. */
export const REDUCE_PHOTO = new InjectionToken<PhotoReducer>('REDUCE_PHOTO', {
  providedIn: 'root',
  factory: () => async (file: Blob) => {
    const image = await createImageBitmap(file);
    const size = reducedSize(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas on this phone.');
    context.drawImage(image, 0, 0, size.width, size.height);
    image.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
    if (blob === null) throw new Error('The photo could not be encoded.');
    return new Uint8Array(await blob.arrayBuffer());
  },
});
