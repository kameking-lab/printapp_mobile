/**
 * 設定画面 - プレミアム（広告非表示・月額200円）購入・復元
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { isExpoGo } from '@/lib/env';
import { usePremium } from '@/lib/premium-context';

export default function SettingsScreen() {
  const { isPremium, isLoading, refresh } = usePremium();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handlePurchase = useCallback(async () => {
    if (isPremium) return;
    if (isExpoGo()) {
      Alert.alert('開発用', 'Expo Go では課金は利用できません。開発ビルドでお試しください。');
      return;
    }
    setPurchasing(true);
    try {
      const Purchases = (await import('react-native-purchases')).default;
      const offerings = await Purchases.getOfferings();
      const defaultOffering = offerings.current;
      if (!defaultOffering) {
        Alert.alert('エラー', '現在のオファリングが設定されていません。');
        return;
      }
      const monthly =
        defaultOffering.monthly ??
        defaultOffering.availablePackages?.find(
          (p: { identifier: string }) =>
            p.identifier === '$rc_monthly' || p.identifier === 'Monthly'
        ) ??
        null;
      if (!monthly) {
        Alert.alert('エラー', '月額プランが見つかりませんでした。');
        return;
      }
      await Purchases.purchasePackage(monthly);
      await refresh();
      Alert.alert('ありがとうございます', 'プレミアム会員になりました。広告は表示されません。');
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean; message?: string; code?: string | number };
      if (err?.userCancelled) return;
      const detail =
        [err?.message, err?.code != null ? `コード: ${err.code}` : '']
          .filter(Boolean)
          .join('\n') || '不明なエラーです。';
      Alert.alert(
        '購入に失敗しました',
        `しばらくしてからお試しください。\n\n【詳細（原因究明用）】\n${detail}`
      );
    } finally {
      setPurchasing(false);
    }
  }, [isPremium, refresh]);

  const handleRestore = useCallback(async () => {
    if (isExpoGo()) {
      Alert.alert('開発用', 'Expo Go では復元は利用できません。開発ビルドでお試しください。');
      return;
    }
    setRestoring(true);
    try {
      const Purchases = (await import('react-native-purchases')).default;
      await Purchases.restorePurchases();
      await refresh();
      Alert.alert('復元完了', '購入を復元しました。');
    } catch {
      Alert.alert('エラー', '復元に失敗しました。');
    } finally {
      setRestoring(false);
    }
  }, [refresh]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.title}>
          設定
        </ThemedText>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.section}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              広告を非表示にする（月額200円）
            </ThemedText>
            <ThemedText style={styles.note}>
              自動更新される月額課金です。解約しない限り毎月更新されます。
            </ThemedText>
            {isLoading ? (
              <ActivityIndicator size="small" color="#7cb342" style={styles.loader} />
            ) : isPremium ? (
              <View style={styles.premiumBadge}>
                <ThemedText style={styles.premiumText}>プレミアム会員です（月額購読中）</ThemedText>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handlePurchase}
                disabled={purchasing}
                activeOpacity={0.8}
              >
                {purchasing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.primaryButtonText}>月額200円で広告を非表示</ThemedText>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleRestore}
              disabled={restoring || isPremium}
              activeOpacity={0.8}
            >
              {restoring ? (
                <ActivityIndicator color="#7cb342" size="small" />
              ) : (
                <ThemedText style={styles.secondaryButtonText}>購入を復元する</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#faf8f5' },
  container: { flex: 1, backgroundColor: '#faf8f5' },
  title: { marginBottom: 16, paddingHorizontal: 20, color: '#2d5016' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionTitle: { marginBottom: 8, color: '#2d5016' },
  note: { fontSize: 12, color: '#6b6b6b', marginBottom: 12, lineHeight: 18 },
  loader: { marginVertical: 12 },
  premiumBadge: {
    backgroundColor: 'rgba(124, 179, 66, 0.15)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  premiumText: { color: '#2d5016', fontWeight: '600' },
  primaryButton: {
    backgroundColor: '#7cb342',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#7cb342', fontSize: 15 },
});
