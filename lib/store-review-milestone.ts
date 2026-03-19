/**
 * 成功体験の回数を AsyncStorage で保持し、5 の倍数で In-App Review をリクエストする。
 * 送信/スキップの判定は OS に委ねる（expo-store-review の仕様）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

const STORAGE_KEY = '@printapp/success_milestone_count';

export async function recordSuccessAndMaybeRequestReview(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    let n = raw ? parseInt(raw, 10) : 0;
    if (!Number.isFinite(n) || n < 0) n = 0;
    n += 1;
    await AsyncStorage.setItem(STORAGE_KEY, String(n));
    if (n % 5 !== 0) return;
    if (!(await StoreReview.isAvailableAsync())) return;
    await StoreReview.requestReview();
  } catch {
    // ストレージ・レビュー API の失敗はユーザー体験を阻害しない
  }
}
