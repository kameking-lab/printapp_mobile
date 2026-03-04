/**
 * 切り抜き画像の上に、確定済み redaction_boxes を白塗りオーバーレイで表示するコンポーネント。
 * ViewShot が使えない環境（Expo Go 等）でも解答が漏れないようフェイルセーフとして使用する。
 */

import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { ImageRegion, RedactionBox } from '@/lib/types';
import { redactionBoxesToCropRelative } from '@/lib/redaction-overlay';

const OVERLAY_COLOR = '#ffffff';

interface CroppedImageWithRedactionProps {
  imageUri: string;
  imageRegion?: ImageRegion;
  redaction_boxes?: RedactionBox[];
  style?: object;
  imageStyle?: object;
}

/**
 * 切り抜き画像を表示し、redaction_boxes がある場合は切り抜き座標に変換して白塗りを重ねる。
 */
export function CroppedImageWithRedaction({
  imageUri,
  imageRegion,
  redaction_boxes,
  style,
  imageStyle,
}: CroppedImageWithRedactionProps) {
  const overlays =
    imageRegion && redaction_boxes?.length
      ? redactionBoxesToCropRelative(redaction_boxes, imageRegion)
      : [];

  const aspectRatio =
    imageRegion && imageRegion.xmax > imageRegion.xmin && imageRegion.ymax > imageRegion.ymin
      ? (imageRegion.xmax - imageRegion.xmin) / (imageRegion.ymax - imageRegion.ymin)
      : undefined;

  return (
    <View style={[styles.wrap, style]}>
      <View
        style={[
          styles.inner,
          aspectRatio != null && Number.isFinite(aspectRatio)
            ? { width: '100%', aspectRatio, maxHeight: 120 }
            : undefined,
        ]}
      >
        <Image
          source={{ uri: imageUri }}
          style={[styles.image, imageStyle]}
          contentFit={aspectRatio != null ? 'cover' : 'contain'}
        />
        {overlays.length > 0 && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {overlays.map((ov, i) => (
              <View
                key={i}
                style={[
                  styles.overlayBox,
                  {
                    left: `${ov.leftPercent}%`,
                    top: `${ov.topPercent}%`,
                    width: `${ov.widthPercent}%`,
                    height: `${ov.heightPercent}%`,
                  },
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 120,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlayBox: {
    position: 'absolute',
    backgroundColor: OVERLAY_COLOR,
  },
});
