import 'react-native-gesture-handler';
import 'react-native-reanimated';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Updates from 'expo-updates';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Alert, InteractionManager } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { requestTrackingPermission } from '@/lib/ads';
import { isExpoGo } from '@/lib/env';
import { PremiumProvider } from '@/lib/premium-context';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    let interactionTask: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
      interactionTask = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        requestTrackingPermission().catch(() => {});
      });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      interactionTask?.cancel();
    };
  }, []);

  // アプリ内アップデート: 起動時に更新を確認し、あればリロードを促す
  useEffect(() => {
    if (isExpoGo()) return;
    let cancelled = false;
    (async () => {
      try {
        if (!Updates.isEnabled) return;
        const update = await Updates.checkForUpdateAsync();
        if (cancelled || !update.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (cancelled) return;
        Alert.alert(
          'アップデートがあります',
          '新しいバージョンが利用可能です。アプリを再起動して適用しますか？',
          [
            { text: 'あとで' },
            { text: '再起動', onPress: () => Updates.reloadAsync() },
          ]
        );
      } catch {
        // 開発ビルドやネット未接続時は無視
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PremiumProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </PremiumProvider>
    </GestureHandlerRootView>
  );
}
