/**
 * AI学習・暗記アプリ - メイン画面
 * プリント解析・お知らせ→カレンダー / テスト→フラッシュカード保存
 */

import { Image } from 'expo-image';
import * as Calendar from 'expo-calendar';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { analyzePrintImage } from '@/lib/analyze-print';
import { initMobileAds, showInterstitialThen, BANNER_UNIT_ID } from '@/lib/ads';
import { cropImageByRegion } from '@/lib/crop-image';
import { saveDeck } from '@/lib/flashcard-storage';
import type {
  AnalyzeResult,
  OshiraseResult,
  TestResult,
  TestProblemItem,
  FlashcardItem,
  SavedDeck,
} from '@/lib/types';

/** 編集可能なお知らせ1件（選択状態含む） */
interface EditableOshiraseItem {
  eventName: string;
  eventDate: string;
  endDate: string;
  memo: string;
  selected: boolean;
}

/** テスト問題の選択状態付き */
interface SelectableProblem extends TestProblemItem {
  selected: boolean;
}

function defaultEndDate(startISO: string): string {
  const d = new Date(startISO);
  d.setHours(d.getHours() + 1);
  return d.toISOString().slice(0, 19);
}

const REMINDER_OPTIONS: { label: string; value: 'none' | number }[] = [
  { label: 'なし', value: 'none' },
  { label: '予定の時刻', value: 0 },
  { label: '5分前', value: -5 },
  { label: '10分前', value: -10 },
  { label: '15分前', value: -15 },
  { label: '30分前', value: -30 },
  { label: '1時間前', value: -60 },
  { label: '2時間前', value: -120 },
  { label: '1日前', value: -1440 },
  { label: '2日前', value: -2880 },
  { label: '1週間前', value: -10080 },
];

const FULLTEXT_HEADER = '\n\n【プリント原文】\n';

export default function HomeScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [imageHeight, setImageHeight] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editedEvents, setEditedEvents] = useState<EditableOshiraseItem[]>([]);
  const [mainReminder, setMainReminder] = useState<'none' | number>('none');
  const [backupReminder, setBackupReminder] = useState<'none' | number>('none');
  const [selectableProblems, setSelectableProblems] = useState<SelectableProblem[]>([]);
  const [testSummaryTitle, setTestSummaryTitle] = useState('');
  const [testSubject, setTestSubject] = useState('');
  const [testDate, setTestDate] = useState('');
  const [savingCards, setSavingCards] = useState(false);

  useEffect(() => {
    initMobileAds().catch(() => {});
  }, []);

  useEffect(() => {
    if (result?.type === 'お知らせ') {
      const events = (result as OshiraseResult).events;
      setEditedEvents(
        events.map((e) => ({
          eventName: e.eventName,
          eventDate: e.eventDate,
          endDate: e.eventEndDate ?? defaultEndDate(e.eventDate),
          memo: e.memo ?? '',
          selected: true,
        }))
      );
      setMainReminder('none');
      setBackupReminder('none');
    } else if (result?.type === 'テスト') {
      const tr = result as TestResult;
      setSelectableProblems(
        tr.problems.map((p) => ({ ...p, selected: true }))
      );
      setTestSummaryTitle(tr.summaryTitle ?? '');
      setTestSubject(tr.subject ?? '');
      setTestDate(tr.date ?? '');
    } else {
      setEditedEvents([]);
      setSelectableProblems([]);
    }
  }, [result]);

  const requestCameraPermission = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('カメラの許可', 'カメラを使うには設定で許可が必要です。', [{ text: 'OK' }]);
      return false;
    }
    return true;
  }, []);

  const requestMediaLibraryPermission = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'フォトライブラリの許可',
        'アルバムから選ぶには設定で許可が必要です。',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  }, []);

  const pickFromCamera = useCallback(async () => {
    const ok = await requestCameraPermission();
    if (!ok) return;
    try {
      const pickerResult = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (pickerResult.canceled) return;
      const asset = pickerResult.assets[0];
      setImageUri(asset.uri);
      setImageBase64(asset.base64 ?? null);
      setImageWidth(asset.width ?? 0);
      setImageHeight(asset.height ?? 0);
      setResult(null);
      setErrorMessage(null);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'カメラの起動に失敗しました。');
    }
  }, [requestCameraPermission]);

  const pickFromAlbum = useCallback(async () => {
    const ok = await requestMediaLibraryPermission();
    if (!ok) return;
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
        base64: true,
      });
      if (pickerResult.canceled) return;
      const asset = pickerResult.assets[0];
      setImageUri(asset.uri);
      setImageBase64(asset.base64 ?? null);
      setImageWidth(asset.width ?? 0);
      setImageHeight(asset.height ?? 0);
      setResult(null);
      setErrorMessage(null);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'アルバムの読み込みに失敗しました。');
    }
  }, [requestMediaLibraryPermission]);

  const analyzeImage = useCallback(async () => {
    if (!imageUri) return;
    setAnalyzing(true);
    setResult(null);
    setErrorMessage(null);
    showInterstitialThen(() => {
      (async () => {
        try {
          let base64: string;
          if (imageBase64 && imageBase64.length > 0) {
            base64 = imageBase64;
          } else {
            base64 = await FileSystemLegacy.readAsStringAsync(imageUri, {
              encoding: FileSystemLegacy.EncodingType.Base64,
            });
          }
          if (!base64 || base64.length === 0) {
            throw new Error('画像の Base64 データを取得できませんでした。');
          }
          const analyzed = await analyzePrintImage(base64, 'image/jpeg');
          setResult(analyzed);
        } catch (e) {
          setErrorMessage(e instanceof Error ? e.message : '解析に失敗しました。');
        } finally {
          setAnalyzing(false);
        }
      })();
    });
  }, [imageUri, imageBase64]);

  const updateEditedEvent = useCallback((index: number, field: keyof EditableOshiraseItem, value: string | boolean) => {
    setEditedEvents((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }, []);

  const toggleSelected = useCallback((index: number) => {
    setEditedEvents((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item))
    );
  }, []);

  const toggleProblemSelected = useCallback((index: number) => {
    setSelectableProblems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item))
    );
  }, []);

  const addToCalendar = useCallback(async () => {
    const selectedItems = editedEvents.filter((e) => e.selected);
    if (selectedItems.length === 0) {
      Alert.alert('確認', 'カレンダーに登録する予定を1件以上選択してください。');
      return;
    }
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'カレンダーの許可',
          'カレンダーに予定を追加するには、設定でカレンダーへのアクセスを許可してください。',
          [{ text: 'OK' }]
        );
        return;
      }
      let calendarId: string;
      if (Platform.OS === 'ios') {
        const defaultCalendar = await Calendar.getDefaultCalendarAsync();
        calendarId = defaultCalendar.id;
      } else {
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const writable = calendars.find((c) => c.allowsModifications);
        if (!writable) {
          Alert.alert('エラー', '書き込み可能なカレンダーが見つかりませんでした。');
          return;
        }
        calendarId = writable.id;
      }

      const alarmOffsets = [mainReminder, backupReminder]
        .filter((x): x is number => x !== 'none')
        .slice(0, 2);
      const alarms = alarmOffsets.map((relativeOffset) => ({ relativeOffset }));

      const fullText =
        result && result.type === 'お知らせ' ? (result as OshiraseResult).fullText : '';
      const fullTextSuffix = fullText ? FULLTEXT_HEADER + fullText : '';

      for (const item of selectedItems) {
        const startDate = new Date(item.eventDate);
        const endDate = new Date(item.endDate);
        const notes = (item.memo || '').trim() + fullTextSuffix;
        await Calendar.createEventAsync(calendarId, {
          title: item.eventName.trim() || '（無題）',
          startDate,
          endDate,
          notes: notes || undefined,
          alarms,
        });
      }
      Alert.alert('成功', `カレンダーに${selectedItems.length}件の予定を登録しました！`);
    } catch (e) {
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : 'カレンダーへの登録に失敗しました。'
      );
    }
  }, [editedEvents, mainReminder, backupReminder, result]);

  const saveAsFlashcards = useCallback(async () => {
    const selected = selectableProblems.filter((p) => p.selected);
    if (selected.length === 0) {
      Alert.alert('確認', '保存する問題を1問以上選択してください。');
      return;
    }
    const subject = testSubject.trim() || 'その他';
    setSavingCards(true);
    try {
      const cards: FlashcardItem[] = [];
      const w = imageWidth > 0 ? imageWidth : 800;
      const h = imageHeight > 0 ? imageHeight : 600;
      for (const prob of selected) {
        let imageUriOut: string | undefined;
        if (prob.imageRegion && imageUri) {
          try {
            imageUriOut = await cropImageByRegion(imageUri, w, h, prob.imageRegion);
          } catch {
            // クロップ失敗時は画像なしで保存
          }
        }
        cards.push({
          question: prob.text,
          answer: '',
          imageUri: imageUriOut,
        });
      }
      const deck: SavedDeck = {
        summaryTitle: testSummaryTitle.trim() || 'テスト',
        subject,
        date: testDate.trim(),
        cards,
        savedAt: new Date().toISOString(),
      };
      await saveDeck(deck);
      Alert.alert('保存しました', `${subject} に ${cards.length} 枚のカードを追加しました。\n「単語帳」タブで確認できます。`, [{ text: 'OK' }]);
    } catch (e) {
      Alert.alert('エラー', e instanceof Error ? e.message : 'フラッシュカードの保存に失敗しました。');
    } finally {
      setSavingCards(false);
    }
  }, [selectableProblems, testSubject, testSummaryTitle, testDate, imageUri, imageWidth, imageHeight]);

  const clearAll = useCallback(() => {
    setImageUri(null);
    setImageBase64(null);
    setImageWidth(0);
    setImageHeight(0);
    setResult(null);
    setErrorMessage(null);
    setEditedEvents([]);
    setSelectableProblems([]);
  }, []);

  const selectedCount = editedEvents.filter((e) => e.selected).length;
  const selectedProblemCount = selectableProblems.filter((p) => p.selected).length;

  const renderReminderRow = (value: 'none' | number, onChange: (v: 'none' | number) => void) => (
    <View style={styles.reminderRow}>
      {REMINDER_OPTIONS.map((opt) => (
        <TouchableOpacity
          key={opt.label}
          style={[styles.reminderButton, value === opt.value && styles.reminderButtonActive]}
          onPress={() => onChange(opt.value)}
          activeOpacity={0.8}
        >
          <ThemedText
            style={[styles.reminderButtonText, value === opt.value && styles.reminderButtonTextActive]}
          >
            {opt.label}
          </ThemedText>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderBanner = () => {
    try {
      const ads = require('react-native-google-mobile-ads');
      const Banner = ads.BannerAd;
      const size = ads.BannerAdSize?.ANCHORED_ADAPTIVE_BANNER ?? ads.BannerAdSize?.BANNER ?? 'BANNER';
      return (
        <View style={styles.bannerWrapper}>
          <Banner
            unitId={BANNER_UNIT_ID ?? ''}
            size={size}
            requestOptions={{ requestNonPersonalizedAdsOnly: false }}
            onAdFailedToLoad={() => {}}
          />
        </View>
      );
    } catch {
      return null;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ThemedView style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="title" style={styles.title}>
            プリント管理
          </ThemedText>
          <ThemedText style={styles.subtitle}>
            カメラで撮影するか、アルバムから画像を選んで解析します。
          </ThemedText>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={pickFromCamera} activeOpacity={0.8}>
              <ThemedText style={styles.primaryButtonText}>カメラで撮る</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={pickFromAlbum} activeOpacity={0.8}>
              <ThemedText style={styles.primaryButtonText}>アルバムから選ぶ</ThemedText>
            </TouchableOpacity>
          </View>

          {errorMessage ? (
            <View style={styles.errorBox}>
              <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
            </View>
          ) : null}

          {imageUri ? (
            <>
              <View style={styles.previewContainer}>
                <Image source={{ uri: imageUri }} style={styles.previewImage} contentFit="contain" />
              </View>
              <TouchableOpacity
                style={[styles.analyzeButton, analyzing && styles.analyzeButtonDisabled]}
                onPress={analyzeImage}
                disabled={analyzing}
                activeOpacity={0.8}
              >
                {analyzing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={styles.analyzeButtonText}>解析する</ThemedText>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearButton} onPress={clearAll} activeOpacity={0.8}>
                <ThemedText style={styles.clearButtonText}>画像をクリア</ThemedText>
              </TouchableOpacity>
            </>
          ) : null}

          {result ? (
            <View style={styles.resultContainer}>
              <ThemedText type="subtitle" style={styles.resultTitle}>
                解析結果: {result.type}
              </ThemedText>

              {result.type === 'お知らせ' ? (
                <View style={styles.oshiraseBox}>
                  <ThemedText style={styles.resultLabel}>
                    予定一覧（編集可・チェックした予定だけカレンダーに追加されます）
                  </ThemedText>
                  {editedEvents.map((item, index) => (
                    <View key={index} style={styles.eventCard}>
                      <TouchableOpacity
                        style={styles.checkboxRow}
                        onPress={() => toggleSelected(index)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.checkbox, item.selected && styles.checkboxChecked]}>
                          {item.selected ? <ThemedText style={styles.checkboxMark}>✓</ThemedText> : null}
                        </View>
                        <ThemedText style={styles.checkboxLabel}>
                          {item.selected ? '登録する' : '登録しない'}
                        </ThemedText>
                      </TouchableOpacity>
                      <ThemedText style={styles.fieldLabel}>イベント名</ThemedText>
                      <TextInput
                        style={styles.input}
                        value={item.eventName}
                        onChangeText={(t) => updateEditedEvent(index, 'eventName', t)}
                        placeholder="イベント名"
                        placeholderTextColor="#999"
                      />
                      <ThemedText style={styles.fieldLabel}>開始日時（ISO例: 2025-03-15T10:00:00）</ThemedText>
                      <TextInput
                        style={styles.input}
                        value={item.eventDate}
                        onChangeText={(t) => updateEditedEvent(index, 'eventDate', t)}
                        placeholder="2025-03-15T10:00:00"
                        placeholderTextColor="#999"
                      />
                      <ThemedText style={styles.fieldLabel}>終了日時</ThemedText>
                      <TextInput
                        style={styles.input}
                        value={item.endDate}
                        onChangeText={(t) => updateEditedEvent(index, 'endDate', t)}
                        placeholder="2025-03-15T11:00:00"
                        placeholderTextColor="#999"
                      />
                      <ThemedText style={styles.fieldLabel}>メモ</ThemedText>
                      <TextInput
                        style={[styles.input, styles.inputMultiline]}
                        value={item.memo}
                        onChangeText={(t) => updateEditedEvent(index, 'memo', t)}
                        placeholder="メモ（任意）"
                        placeholderTextColor="#999"
                        multiline
                        numberOfLines={2}
                      />
                    </View>
                  ))}

                  <ThemedText style={styles.fieldLabel}>メイン通知</ThemedText>
                  {renderReminderRow(mainReminder, setMainReminder)}

                  <ThemedText style={styles.fieldLabel}>予備の通知</ThemedText>
                  {renderReminderRow(backupReminder, setBackupReminder)}

                  <TouchableOpacity
                    style={styles.shareButton}
                    onPress={addToCalendar}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.shareButtonText}>
                      選択した予定をカレンダーに追加（{selectedCount}件）
                    </ThemedText>
                  </TouchableOpacity>
                  <ThemedText style={styles.imageNote}>
                    登録時、プリントの全文を予定のメモに【プリント原文】として追記します。
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.testBox}>
                  <ThemedText style={styles.resultLabel}>要約・科目・日付（編集可）</ThemedText>
                  <ThemedText style={styles.fieldLabel}>タイトル</ThemedText>
                  <TextInput
                    style={styles.input}
                    value={testSummaryTitle}
                    onChangeText={setTestSummaryTitle}
                    placeholder="例: 第2回計算テスト"
                    placeholderTextColor="#999"
                  />
                  <ThemedText style={styles.fieldLabel}>科目</ThemedText>
                  <TextInput
                    style={styles.input}
                    value={testSubject}
                    onChangeText={setTestSubject}
                    placeholder="例: 算数"
                    placeholderTextColor="#999"
                  />
                  <ThemedText style={styles.fieldLabel}>日付</ThemedText>
                  <TextInput
                    style={styles.input}
                    value={testDate}
                    onChangeText={setTestDate}
                    placeholder="例: 2025-03-15"
                    placeholderTextColor="#999"
                  />
                  <ThemedText style={styles.resultLabel}>問題一覧（保存する問題を選択）</ThemedText>
                  {selectableProblems.map((item, index) => (
                    <View key={index} style={styles.problemCard}>
                      <TouchableOpacity
                        style={styles.checkboxRow}
                        onPress={() => toggleProblemSelected(index)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.checkbox, item.selected && styles.checkboxChecked]}>
                          {item.selected ? <ThemedText style={styles.checkboxMark}>✓</ThemedText> : null}
                        </View>
                        <ThemedText style={styles.checkboxLabel}>
                          {item.selected ? '保存する' : '保存しない'}
                        </ThemedText>
                      </TouchableOpacity>
                      <ThemedText style={styles.problemText}>{item.text}</ThemedText>
                      {item.imageRegion ? (
                        <ThemedText style={styles.figureNote}>📐 図形領域あり（保存時に切り抜き）</ThemedText>
                      ) : null}
                    </View>
                  ))}
                  <TouchableOpacity
                    style={[styles.shareButton, savingCards && styles.analyzeButtonDisabled]}
                    onPress={saveAsFlashcards}
                    disabled={savingCards}
                    activeOpacity={0.8}
                  >
                    {savingCards ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <ThemedText style={styles.shareButtonText}>
                        フラッシュカードに保存（{selectedProblemCount}問）
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                  <ThemedText style={styles.imageNote}>
                    「単語帳」タブでカードをめくって暗記できます。図形がある問題は画像で保存されます。
                  </ThemedText>
                </View>
              )}
            </View>
          ) : null}
        </ScrollView>
        {renderBanner()}
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#faf8f5',
  },
  container: {
    flex: 1,
    backgroundColor: '#faf8f5',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  title: {
    marginBottom: 8,
    color: '#2d5016',
  },
  subtitle: {
    marginBottom: 24,
    opacity: 0.9,
    color: '#5a6c54',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#7cb342',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: 'rgba(211, 47, 47, 0.12)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(211, 47, 47, 0.3)',
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
  },
  previewContainer: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#eee8e0',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  analyzeButton: {
    backgroundColor: '#43a047',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  analyzeButtonDisabled: {
    opacity: 0.7,
  },
  analyzeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  clearButton: {
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 24,
  },
  clearButtonText: {
    fontSize: 14,
    color: '#6b6b6b',
  },
  resultContainer: {
    marginTop: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(124, 179, 66, 0.35)',
    backgroundColor: '#fffefb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  resultTitle: {
    marginBottom: 12,
    color: '#2d5016',
  },
  resultLabel: {
    fontSize: 12,
    opacity: 0.85,
    marginTop: 8,
    marginBottom: 2,
    color: '#5a6c54',
  },
  oshiraseBox: {
    marginTop: 4,
  },
  eventCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(124, 179, 66, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(124, 179, 66, 0.2)',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#7cb342',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkboxChecked: {
    backgroundColor: '#7cb342',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#333',
  },
  fieldLabel: {
    fontSize: 12,
    opacity: 0.85,
    marginTop: 8,
    marginBottom: 4,
    color: '#5a6c54',
  },
  input: {
    borderWidth: 1,
    borderColor: '#c8d4c0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  inputMultiline: {
    minHeight: 56,
    textAlignVertical: 'top',
  },
  reminderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  reminderButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7cb342',
  },
  reminderButtonActive: {
    backgroundColor: '#7cb342',
  },
  reminderButtonText: {
    fontSize: 12,
    color: '#7cb342',
  },
  reminderButtonTextActive: {
    color: '#fff',
  },
  shareButton: {
    backgroundColor: '#7cb342',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  imageNote: {
    fontSize: 11,
    opacity: 0.8,
    marginTop: 8,
    color: '#6b6b6b',
  },
  testBox: {
    marginTop: 4,
  },
  problemCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  problemText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#333',
    marginTop: 4,
  },
  figureNote: {
    fontSize: 11,
    color: '#7cb342',
    marginTop: 4,
  },
  bannerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
});
