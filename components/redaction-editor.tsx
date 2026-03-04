/**
 * 白抜き領域の確認・編集フルスクリーンUI
 * 画像と枠を同一の Animated.View 内に置き、ズーム/パンはその親に適用。
 * タッチ座標は必ずコンテナ内ローカル（event.x / event.y）で処理し、ズーム時も座標が狂わないようにする。
 * モード切替ボタンはなく、指の数で自動分岐：2本指＝ズーム/パン、1本指＝枠の作成・移動・リサイズ、長押し＝削除。
 */

import { Image } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  TouchableOpacity as GestureTouchableOpacity,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pastel } from '@/constants/theme';
import type { RedactionBox } from '@/lib/types';

/** コンテナのレイアウト（幅・高さのみ。ローカル座標変換用） */
interface LayoutSize {
  width: number;
  height: number;
}

/** ハンドル・枠中央のヒット判定半径（px）。誤タップを減らすため少しタイトめ */
const HANDLE_HIT_RADIUS_PX = 18;
const HANDLE_DISPLAY_SIZE = 16;
const OVERLAY_COLOR = 'rgba(100, 150, 255, 0.35)';
const OVERLAY_BORDER = '#c62828';
const HANDLE_COLOR = Pastel.coral;
/** 新規枠として確定する最小移動距離（%）。2本指誤爆防止 */
const MIN_DRAW_DISTANCE_PERCENT = 2;
/** 長押しで削除が発火するまでの時間（ms） */
const LONG_PRESS_DURATION_MS = 400;
/** Android 実機デバッグ時のみジェスチャーログを有効化 */
const ENABLE_ANDROID_GESTURE_DEBUG = __DEV__ && Platform.OS === 'android';
/** 選択中の削除ボタンの見た目サイズ（配置計算用の目安） */
const DELETE_BUTTON_WIDTH_PX = 88;
const DELETE_BUTTON_HEIGHT_PX = 34;
const DELETE_BUTTON_MARGIN_PX = 6;
const DELETE_BUTTON_OFFSET_Y_PX = 8;

type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** 枠の四隅のハンドル中心座標（ピクセル）を算出し、タッチが HANDLE_HIT_RADIUS_PX 以内か判定 */
function hitTestCorner(
  touchX: number,
  touchY: number,
  box: RedactionBox,
  layoutWidth: number,
  layoutHeight: number
): Corner | null {
  const boxPxX = (box.x_percent / 100) * layoutWidth;
  const boxPxY = (box.y_percent / 100) * layoutHeight;
  const boxPxW = (box.width_percent / 100) * layoutWidth;
  const boxPxH = (box.height_percent / 100) * layoutHeight;
  const corners: { corner: Corner; x: number; y: number }[] = [
    { corner: 'tl', x: boxPxX, y: boxPxY },
    { corner: 'tr', x: boxPxX + boxPxW, y: boxPxY },
    { corner: 'bl', x: boxPxX, y: boxPxY + boxPxH },
    { corner: 'br', x: boxPxX + boxPxW, y: boxPxY + boxPxH },
  ];
  for (const { corner, x, y } of corners) {
    const dx = touchX - x;
    const dy = touchY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= HANDLE_HIT_RADIUS_PX) return corner;
  }
  return null;
}

/** タッチ（ピクセル）が枠の矩形内にあるか。枠もピクセルに変換して比較 */
function isInsideBoxPx(
  touchX: number,
  touchY: number,
  box: RedactionBox,
  layoutWidth: number,
  layoutHeight: number
): boolean {
  const boxPxX = (box.x_percent / 100) * layoutWidth;
  const boxPxY = (box.y_percent / 100) * layoutHeight;
  const boxPxW = (box.width_percent / 100) * layoutWidth;
  const boxPxH = (box.height_percent / 100) * layoutHeight;
  return (
    touchX >= boxPxX &&
    touchX <= boxPxX + boxPxW &&
    touchY >= boxPxY &&
    touchY <= boxPxY + boxPxH
  );
}

/** 枠の「中央」＝枠内かつ四隅のハンドル円（HANDLE_HIT_RADIUS_PX）に触れていない領域 */
function isInBoxCenterPx(
  touchX: number,
  touchY: number,
  box: RedactionBox,
  layoutWidth: number,
  layoutHeight: number
): boolean {
  if (!isInsideBoxPx(touchX, touchY, box, layoutWidth, layoutHeight)) return false;
  return hitTestCorner(touchX, touchY, box, layoutWidth, layoutHeight) === null;
}

interface RedactionEditorProps {
  visible: boolean;
  imageUri: string;
  imageWidth: number;
  imageHeight: number;
  initialBoxes: RedactionBox[];
  onComplete: (boxes: RedactionBox[]) => void;
}

function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** ローカル座標 (px) を 0〜100% に変換 */
function localToPercent(x: number, y: number, width: number, height: number): { x: number; y: number } {
  if (width <= 0 || height <= 0) return { x: 0, y: 0 };
  return {
    x: clampPercent((x / width) * 100),
    y: clampPercent((y / height) * 100),
  };
}

function getDeleteButtonPositionPx(box: RedactionBox, lay: LayoutSize): { left: number; top: number } {
  const anchorX = ((box.x_percent + box.width_percent) / 100) * lay.width;
  const anchorY = (box.y_percent / 100) * lay.height;
  const maxLeft = Math.max(DELETE_BUTTON_MARGIN_PX, lay.width - DELETE_BUTTON_WIDTH_PX - DELETE_BUTTON_MARGIN_PX);
  const maxTop = Math.max(DELETE_BUTTON_MARGIN_PX, lay.height - DELETE_BUTTON_HEIGHT_PX - DELETE_BUTTON_MARGIN_PX);
  const preferredLeft = anchorX - DELETE_BUTTON_WIDTH_PX;
  const preferredTop = anchorY - DELETE_BUTTON_HEIGHT_PX - DELETE_BUTTON_OFFSET_Y_PX;

  return {
    left: Math.max(DELETE_BUTTON_MARGIN_PX, Math.min(maxLeft, preferredLeft)),
    top: Math.max(DELETE_BUTTON_MARGIN_PX, Math.min(maxTop, preferredTop)),
  };
}

export function RedactionEditor({
  visible,
  imageUri,
  imageWidth,
  imageHeight,
  initialBoxes,
  onComplete,
}: RedactionEditorProps) {
  const insets = useSafeAreaInsets();
  const [boxes, setBoxes] = useState<RedactionBox[]>(initialBoxes);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [layout, setLayout] = useState<LayoutSize | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  const layoutRef = useRef<LayoutSize | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const resizeBoxIndex = useRef<number | null>(null);
  const resizeCorner = useRef<Corner | null>(null);
  const resizeStart = useRef<RedactionBox | null>(null);
  const moveBoxIndex = useRef<number | null>(null);
  const moveStart = useRef<RedactionBox | null>(null);
  const moveStartTouch = useRef<{ x: number; y: number } | null>(null);
  const oneFingerMode = useRef<'resize' | 'move' | 'draw' | null>(null);
  /** onBegin 時点の layout。onUpdate では State ではなくこの Ref のみ参照する */
  const layoutAtBeginRef = useRef<LayoutSize | null>(null);
  const gestureLogTimesRef = useRef<Record<string, number>>({});

  const logGesture = useCallback(
    (phase: string, payload?: Record<string, unknown>, throttleMs = 0) => {
      if (!ENABLE_ANDROID_GESTURE_DEBUG) return;
      if (throttleMs > 0) {
        const now = Date.now();
        const last = gestureLogTimesRef.current[phase] ?? 0;
        if (now - last < throttleMs) return;
        gestureLogTimesRef.current[phase] = now;
      }
      if (payload) {
        console.log(`[RedactionEditor][${phase}]`, payload);
      } else {
        console.log(`[RedactionEditor][${phase}]`);
      }
    },
    []
  );

  const safeWidth = Math.max(1, Number(imageWidth) || 800);
  const safeHeight = Math.max(1, Number(imageHeight) || 600);
  const aspectRatio = safeWidth / safeHeight;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setBoxes(initialBoxes);
      setSelectedIndex(null);
      setDrawStart(null);
      setDrawCurrent(null);
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    }
  }, [visible, initialBoxes]);

  const addBoxFromDraw = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const x1 = Math.min(start.x, end.x);
      const x2 = Math.max(start.x, end.x);
      const y1 = Math.min(start.y, end.y);
      const y2 = Math.max(start.y, end.y);
      const w = x2 - x1;
      const h = y2 - y1;
      if (w < 2 || h < 2) return;
      setBoxes((prev) => [
        ...prev,
        { x_percent: x1, y_percent: y1, width_percent: w, height_percent: h },
      ]);
    },
    []
  );

  /** 指が画面に触れた瞬間（onBegin）で1回だけ実行。ヒットテストはピクセル座標で行い、対象をロックする。ドラッグ開始時の layout を Ref に保存 */
  const handleOneFingerBegin = useCallback(
    (xPx: number, yPx: number) => {
      const lay = layoutRef.current;
      if (!lay || lay.width <= 0 || lay.height <= 0) return;
      layoutAtBeginRef.current = { width: lay.width, height: lay.height };
      // どこかをタップしたタイミングで一旦選択は解除し、後続のヒット結果で必要なら選択し直す
      setSelectedIndex(null);
      const currentBoxes = boxes;

      // ヒットテストはすべてピクセル座標で実施（e.x, e.y がそのままピクセル）
      let hitResize: { index: number; corner: Corner } | null = null;
      for (let i = currentBoxes.length - 1; i >= 0; i--) {
        const corner = hitTestCorner(xPx, yPx, currentBoxes[i], lay.width, lay.height);
        if (corner) {
          hitResize = { index: i, corner };
          break;
        }
      }
      if (hitResize) {
        logGesture('onePan:hitResize', { boxIndex: hitResize.index, corner: hitResize.corner });
        oneFingerMode.current = 'resize';
        resizeBoxIndex.current = hitResize.index;
        resizeCorner.current = hitResize.corner;
        const b = currentBoxes[hitResize.index];
        if (b) resizeStart.current = { ...b };
        setDrawStart(null);
        setDrawCurrent(null);
        drawStartRef.current = null;
        drawCurrentRef.current = null;
        moveBoxIndex.current = null;
        moveStart.current = null;
        moveStartTouch.current = null;
        return;
      }

      let insideBoxIndex: number | null = null;
      let inCenter = false;
      for (let i = currentBoxes.length - 1; i >= 0; i--) {
        if (isInsideBoxPx(xPx, yPx, currentBoxes[i], lay.width, lay.height)) {
          insideBoxIndex = i;
          inCenter = isInBoxCenterPx(xPx, yPx, currentBoxes[i], lay.width, lay.height);
          break;
        }
      }
      if (insideBoxIndex !== null) {
        setSelectedIndex(insideBoxIndex);
        setDrawStart(null);
        setDrawCurrent(null);
        drawStartRef.current = null;
        drawCurrentRef.current = null;
        resizeBoxIndex.current = null;
        resizeCorner.current = null;
        if (inCenter) {
          logGesture('onePan:hitMove', { boxIndex: insideBoxIndex });
          oneFingerMode.current = 'move';
          const b = currentBoxes[insideBoxIndex];
          if (b) {
            moveBoxIndex.current = insideBoxIndex;
            moveStart.current = { ...b };
            moveStartTouch.current = localToPercent(xPx, yPx, lay.width, lay.height);
          }
        } else {
          oneFingerMode.current = null;
        }
        return;
      }

      logGesture('onePan:hitDraw');
      const p = localToPercent(xPx, yPx, lay.width, lay.height);
      oneFingerMode.current = 'draw';
      drawStartRef.current = p;
      drawCurrentRef.current = p;
      setDrawStart(p);
      setDrawCurrent(p);
      resizeBoxIndex.current = null;
      resizeCorner.current = null;
      moveBoxIndex.current = null;
      moveStart.current = null;
      moveStartTouch.current = null;
    },
    [boxes, logGesture]
  );

  /** onUpdate: Ref に保存した「ドラッグ開始時の値」のみをベースに計算。移動は開始タッチとの差分、リサイズは現在座標で計算 */
  const handleOneFingerUpdate = useCallback(
    (xPx: number, yPx: number, translationX: number, translationY: number) => {
      logGesture(
        'onePan:onUpdate:js',
        { translationX, translationY, x: xPx, y: yPx },
        120
      );
      const lay = layoutAtBeginRef.current || layoutRef.current;
      if (!lay || lay.width <= 0 || lay.height <= 0) return;
      const w = lay.width || 1;
      const h = lay.height || 1;
      const p = localToPercent(xPx, yPx, w, h);
      const safeP = { x: Number(p.x) || 0, y: Number(p.y) || 0 };

      drawCurrentRef.current = safeP;
      setDrawCurrent({ ...safeP });

      // 移動: 開始時のタッチ位置との差分（パーセント）を、開始時の枠座標に加算する
      if (moveBoxIndex.current !== null && moveStart.current !== null && moveStartTouch.current !== null) {
        const i = moveBoxIndex.current;
        const start = moveStart.current;
        const touchStart = moveStartTouch.current;
        const dxPercent = safeP.x - (Number(touchStart.x) || 0);
        const dyPercent = safeP.y - (Number(touchStart.y) || 0);
        const newBox: RedactionBox = {
          x_percent: clampPercent((Number(start.x_percent) || 0) + dxPercent),
          y_percent: clampPercent((Number(start.y_percent) || 0) + dyPercent),
          width_percent: Math.max(0, Number(start.width_percent) || 0),
          height_percent: Math.max(0, Number(start.height_percent) || 0),
        };
        if (Number.isFinite(newBox.x_percent) && Number.isFinite(newBox.y_percent) && Number.isFinite(newBox.width_percent) && Number.isFinite(newBox.height_percent)) {
          setBoxes((prev) => prev.map((b, idx) => (idx === i ? newBox : b)));
        }
      } else if (resizeBoxIndex.current !== null && resizeCorner.current !== null && resizeStart.current !== null) {
        const i = resizeBoxIndex.current;
        const corner = resizeCorner.current;
        const start = resizeStart.current;
        const sx = Number(start.x_percent) || 0;
        const sy = Number(start.y_percent) || 0;
        const sw = Math.max(0, Number(start.width_percent) || 0);
        const sh = Math.max(0, Number(start.height_percent) || 0);
        const px = safeP.x;
        const py = safeP.y;
        let newBox: RedactionBox;
        if (corner === 'tl') {
          newBox = {
            x_percent: clampPercent(px),
            y_percent: clampPercent(py),
            width_percent: Math.max(0.5, clampPercent(sx + sw - px)),
            height_percent: Math.max(0.5, clampPercent(sy + sh - py)),
          };
        } else if (corner === 'tr') {
          newBox = {
            x_percent: sx,
            y_percent: clampPercent(py),
            width_percent: Math.max(0.5, clampPercent(px - sx)),
            height_percent: Math.max(0.5, clampPercent(sy + sh - py)),
          };
        } else if (corner === 'bl') {
          newBox = {
            x_percent: clampPercent(px),
            y_percent: sy,
            width_percent: Math.max(0.5, clampPercent(sx + sw - px)),
            height_percent: Math.max(0.5, clampPercent(py - sy)),
          };
        } else {
          newBox = {
            x_percent: sx,
            y_percent: sy,
            width_percent: Math.max(0.5, clampPercent(px - sx)),
            height_percent: Math.max(0.5, clampPercent(py - sy)),
          };
        }
        if (newBox.width_percent >= 0.5 && newBox.height_percent >= 0.5 && Number.isFinite(newBox.x_percent) && Number.isFinite(newBox.y_percent)) {
          setBoxes((prev) => prev.map((b, idx) => (idx === i ? newBox : b)));
        }
      }
    },
    [logGesture]
  );

  const handleOneFingerEnd = useCallback(() => {
    logGesture('onePan:onEnd:js');
    const s = drawStartRef.current;
    const c = drawCurrentRef.current;
    if (oneFingerMode.current === 'draw' && s && c) {
      const dist = Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
      if (dist >= MIN_DRAW_DISTANCE_PERCENT) {
        addBoxFromDraw(s, c);
      }
    }
    drawStartRef.current = null;
    drawCurrentRef.current = null;
    setDrawStart(null);
    setDrawCurrent(null);
    resizeBoxIndex.current = null;
    resizeCorner.current = null;
    resizeStart.current = null;
    moveBoxIndex.current = null;
    moveStart.current = null;
    moveStartTouch.current = null;
    oneFingerMode.current = null;
    layoutAtBeginRef.current = null;
  }, [addBoxFromDraw, logGesture]);

  const handleLongPress = useCallback(
    (xPx: number, yPx: number) => {
      const lay = layoutRef.current;
      if (!lay || lay.width <= 0 || lay.height <= 0) return;
      const currentBoxes = boxes;
      let found: number | null = null;
      for (let i = currentBoxes.length - 1; i >= 0; i--) {
        if (isInsideBoxPx(xPx, yPx, currentBoxes[i], lay.width, lay.height)) {
          found = i;
          break;
        }
      }
      if (found === null) return;
      const idx = found;
      Alert.alert('白抜き枠の削除', 'この枠を削除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: () => {
            setBoxes((prev) => prev.filter((_, i) => i !== idx));
            setSelectedIndex(null);
          },
        },
      ]);
    },
    [boxes]
  );

  const handleLayout = useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = e.nativeEvent.layout;
    layoutRef.current = { width, height };
    setLayout({ width, height });
  }, []);

  const handleDelete = useCallback((index: number) => {
    setBoxes((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex(null);
  }, []);

  const handleComplete = useCallback(() => {
    onComplete(boxes);
  }, [boxes, onComplete]);

  const pinchGesture = Gesture.Pinch()
    .onBegin(() => {
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)('pinch:onBegin');
      }
    })
    .onUpdate((e) => {
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)(
          'pinch:onUpdate',
          { scale: e.scale, focalX: e.focalX, focalY: e.focalY },
          120
        );
      }
      scale.value = savedScale.value * e.scale;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)('pinch:onEnd', { savedScale: savedScale.value });
      }
    });

  const pan2Gesture = Gesture.Pan()
    .minPointers(2)
    .onBegin((e) => {
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)('twoPan:onBegin', { x: e.x, y: e.y });
      }
    })
    .onUpdate((e) => {
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)(
          'twoPan:onUpdate',
          { translationX: e.translationX, translationY: e.translationY, x: e.x, y: e.y },
          120
        );
      }
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)('twoPan:onEnd', {
          savedTranslateX: savedTranslateX.value,
          savedTranslateY: savedTranslateY.value,
        });
      }
    });

  const twoFingerGesture = Gesture.Simultaneous(pinchGesture, pan2Gesture);

  const oneFingerPanGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onBegin((e) => {
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)('onePan:onBegin', { x: e.x, y: e.y, pointers: e.numberOfPointers });
      }
      runOnJS(handleOneFingerBegin)(e.x, e.y);
    })
    .onUpdate((e) => {
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)(
          'onePan:onUpdate',
          { translationX: e.translationX, translationY: e.translationY, x: e.x, y: e.y },
          120
        );
      }
      runOnJS(handleOneFingerUpdate)(e.x, e.y, e.translationX, e.translationY);
    })
    .onEnd(() => {
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)('onePan:onEnd');
      }
      runOnJS(handleOneFingerEnd)();
    })
    .onFinalize((_e, success) => {
      if (ENABLE_ANDROID_GESTURE_DEBUG) {
        runOnJS(logGesture)('onePan:onFinalize', { success });
      }
    });

  // 2本指ズーム／移動と1本指Panを同時許可する。
  // minPointers(2) の twoFingerGesture と minPointers(1)/maxPointers(1) の oneFingerPanGesture が
  // 指の本数で自然に振り分けられる。
  const composed = Gesture.Simultaneous(twoFingerGesture, oneFingerPanGesture);

  const zoomAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const selectedBox = selectedIndex !== null ? boxes[selectedIndex] ?? null : null;
  const deleteButtonPosition =
    selectedBox && layout ? getDeleteButtonPositionPx(selectedBox, layout) : null;

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <GestureHandlerRootView style={styles.modalGestureRoot}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={[styles.header, { paddingTop: Math.max(12, insets.top) }]}>
            <Text style={styles.title}>白抜き領域の確認・編集</Text>
            <Text style={styles.hint}>2本指: ズーム・移動 / 1本指: 枠の追加・移動・リサイズ / タップ: 選択・削除</Text>
          </View>
          <View style={styles.imageWrapper}>
            <Animated.View
              collapsable={false}
              style={[
                styles.zoomWrapper,
                { aspectRatio: Number.isFinite(aspectRatio) ? aspectRatio : 1 },
                zoomAnimatedStyle,
              ]}
              onLayout={handleLayout}
            >
              <GestureDetector gesture={composed}>
                <View style={styles.imageContainer} collapsable={false} pointerEvents="box-none">
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.image}
                    contentFit="contain"
                    pointerEvents="none"
                  />
                  <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    {boxes.map((box, i) => (
                      <View
                        key={i}
                        style={[
                          styles.overlayBox,
                          {
                            left: `${box.x_percent}%`,
                            top: `${box.y_percent}%`,
                            width: `${box.width_percent}%`,
                            height: `${box.height_percent}%`,
                          },
                        ]}
                      />
                    ))}
                    {layout && boxes.map((box, i) =>
                      selectedIndex === i
                        ? (['tl', 'tr', 'bl', 'br'] as const).map((corner) => {
                            const left =
                              corner === 'tl' || corner === 'bl' ? box.x_percent : box.x_percent + box.width_percent;
                            const top =
                              corner === 'tl' || corner === 'tr' ? box.y_percent : box.y_percent + box.height_percent;
                            return (
                              <View
                                key={`handle-${i}-${corner}`}
                                style={[
                                  styles.cornerHandleWrap,
                                  { left: `${left}%`, top: `${top}%` },
                                ]}
                              >
                                <View style={styles.cornerHandle} />
                              </View>
                            );
                          })
                        : null
                    )}
                    {drawStart && drawCurrent && (
                      <View
                        style={[
                          styles.overlayBox,
                          styles.drawPreview,
                          {
                            left: `${Math.min(drawStart.x, drawCurrent.x)}%`,
                            top: `${Math.min(drawStart.y, drawCurrent.y)}%`,
                            width: `${Math.max(0.5, Math.abs(drawCurrent.x - drawStart.x))}%`,
                            height: `${Math.max(0.5, Math.abs(drawCurrent.y - drawStart.y))}%`,
                          },
                        ]}
                      />
                    )}
                  </View>
                </View>
              </GestureDetector>
              {selectedBox && deleteButtonPosition && selectedIndex !== null && (
                <View style={styles.deleteButtonLayer} pointerEvents="box-none">
                  <GestureTouchableOpacity
                    style={[
                      styles.deleteButtonFloating,
                      { left: deleteButtonPosition.left, top: deleteButtonPosition.top },
                    ]}
                    onPress={() => handleDelete(selectedIndex)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.deleteText}>× 削除</Text>
                  </GestureTouchableOpacity>
                </View>
              )}
            </Animated.View>
          </View>
          <View style={styles.footer}>
            <TouchableOpacity style={styles.completeButton} onPress={handleComplete} activeOpacity={0.85}>
              <Text style={styles.completeButtonText}>完了（フラッシュカードを作成）</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalGestureRoot: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#1a1a1a' },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  hint: { fontSize: 12, color: '#aaa', marginTop: 4 },
  imageWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8, overflow: 'visible' },
  zoomWrapper: { width: '100%', overflow: 'visible' },
  imageContainer: { width: '100%', height: '100%', borderRadius: 8 },
  image: { width: '100%', height: '100%', borderRadius: 8 },
  overlayBox: {
    position: 'absolute',
    backgroundColor: OVERLAY_COLOR,
    borderWidth: 2,
    borderColor: OVERLAY_BORDER,
  },
  cornerHandleWrap: {
    position: 'absolute',
    width: HANDLE_DISPLAY_SIZE,
    height: HANDLE_DISPLAY_SIZE,
    marginLeft: -HANDLE_DISPLAY_SIZE / 2,
    marginTop: -HANDLE_DISPLAY_SIZE / 2,
  },
  cornerHandle: {
    width: HANDLE_DISPLAY_SIZE,
    height: HANDLE_DISPLAY_SIZE,
    borderRadius: HANDLE_DISPLAY_SIZE / 2,
    backgroundColor: HANDLE_COLOR,
    borderWidth: 2,
    borderColor: '#fff',
  },
  drawPreview: { borderStyle: 'dashed' },
  deleteButtonLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'visible',
    zIndex: 40,
    elevation: 40,
  },
  deleteButtonFloating: {
    position: 'absolute',
    backgroundColor: Pastel.error,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 41,
    elevation: 41,
  },
  deleteText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  footer: { padding: 16, paddingBottom: 24 },
  completeButton: {
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 16,
    borderRadius: Pastel.borderRadiusButton,
    alignItems: 'center',
    ...Pastel.shadowStyle,
  },
  completeButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
