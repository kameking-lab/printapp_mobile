/**
 * カレンダー登録完了時に通知トレイへ即時表示するローカル通知
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/** 登録件数に応じた本文 */
function bodyForCount(count: number): string {
  return count === 1 ? '1件の予定を追加しました' : `${count}件の予定を追加しました`;
}

/**
 * カレンダー登録完了を通知する（権限がなければ要求し、許可時のみ表示）
 * 失敗時は静かに無視（Expo Go 等では表示されない場合あり）
 */
export async function notifyCalendarRegistrationComplete(count: number): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const { status: requested } = await Notifications.requestPermissionsAsync();
      status = requested;
    }
    if (status !== 'granted') return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'カレンダーに登録しました',
        body: bodyForCount(count),
        data: { source: 'calendar_registration' },
        ...(Platform.OS === 'android' ? { channelId: 'calendar' } : {}),
      },
      trigger: null,
    });
  } catch {
    // Expo Go や権限未対応環境では無視
  }
}
