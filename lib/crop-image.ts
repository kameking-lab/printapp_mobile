/**
 * 画像を正規化座標（0〜1）でクロップする
 */

import * as ImageManipulator from 'expo-image-manipulator';
import type { ImageRegion } from './types';

/**
 * 画像の指定領域をクロップし、保存したURIを返す。
 * 座標は 0〜1 の割合。画像サイズはピクセルで指定。
 */
export async function cropImageByRegion(
  imageUri: string,
  imageWidth: number,
  imageHeight: number,
  region: ImageRegion
): Promise<string> {
  const originX = Math.max(0, Math.floor(region.xmin * imageWidth));
  const originY = Math.max(0, Math.floor(region.ymin * imageHeight));
  const width = Math.min(
    imageWidth - originX,
    Math.max(1, Math.floor((region.xmax - region.xmin) * imageWidth))
  );
  const height = Math.min(
    imageHeight - originY,
    Math.max(1, Math.floor((region.ymax - region.ymin) * imageHeight))
  );

  console.log('[Flashcards] cropImageByRegion input', {
    imageUri,
    imageWidth,
    imageHeight,
    region,
    cropRect: { originX, originY, width, height },
  });

  try {
    const result = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ crop: { originX, originY, width, height } }],
      {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    console.log('[Flashcards] cropImageByRegion output', {
      outputUri: result.uri,
    });

    return result.uri ?? imageUri;
  } catch (e) {
    console.error('[Flashcards] cropImageByRegion failed, fallback to original image', e);
    return imageUri;
  }
}
