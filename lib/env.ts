/**
 * 実行環境の判定（Expo Go ではネイティブモジュールが含まれないためガードに使用）
 */

import Constants from 'expo-constants';

/** Expo Go で実行中か（開発ビルド・本番ビルドでは false） */
export function isExpoGo(): boolean {
  try {
    return Constants.appOwnership === 'expo';
  } catch {
    return false;
  }
}
