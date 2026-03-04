/**
 * 切り抜き画像上に白塗りを重ねるための座標変換。
 * 全体画像の redaction_boxes（0〜100%）と、切り抜き領域 imageRegion（0〜1）から、
 * 「切り抜き画像内での 0〜100%」のオーバーレイ矩形を計算する。
 */

import type { ImageRegion, RedactionBox } from './types';

export interface CropRelativeOverlay {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
}

/**
 * 全体画像の白塗り枠を、指定した切り抜き領域（0〜1）に対する相対座標（0〜100%）に変換する。
 * 切り抜きと重ならない枠は返さない。
 */
export function redactionBoxesToCropRelative(
  redaction_boxes: RedactionBox[],
  imageRegion: ImageRegion
): CropRelativeOverlay[] {
  const xmin = imageRegion.xmin;
  const ymin = imageRegion.ymin;
  const xmax = imageRegion.xmax;
  const ymax = imageRegion.ymax;
  const cropW = xmax - xmin;
  const cropH = ymax - ymin;
  if (cropW <= 0 || cropH <= 0) return [];

  const cropLeftPct = xmin * 100;
  const cropTopPct = ymin * 100;
  const cropWidthPct = cropW * 100;
  const cropHeightPct = cropH * 100;
  const cropRightPct = cropLeftPct + cropWidthPct;
  const cropBottomPct = cropTopPct + cropHeightPct;

  const result: CropRelativeOverlay[] = [];
  for (const box of redaction_boxes) {
    const boxLeft = box.x_percent;
    const boxTop = box.y_percent;
    const boxRight = box.x_percent + box.width_percent;
    const boxBottom = box.y_percent + box.height_percent;

    const interLeft = Math.max(boxLeft, cropLeftPct);
    const interRight = Math.min(boxRight, cropRightPct);
    const interTop = Math.max(boxTop, cropTopPct);
    const interBottom = Math.min(boxBottom, cropBottomPct);

    if (interLeft >= interRight || interTop >= interBottom) continue;

    const leftPercent = ((interLeft - cropLeftPct) / cropWidthPct) * 100;
    const topPercent = ((interTop - cropTopPct) / cropHeightPct) * 100;
    const widthPercent = ((interRight - interLeft) / cropWidthPct) * 100;
    const heightPercent = ((interBottom - interTop) / cropHeightPct) * 100;

    result.push({ leftPercent, topPercent, widthPercent, heightPercent });
  }
  return result;
}
