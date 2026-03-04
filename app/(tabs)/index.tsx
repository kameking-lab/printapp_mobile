/**
 * AI学習・暗記アプリ - メイン画面
 * プリント解析・お知らせ→カレンダー / テスト→フラッシュカード保存
 */

import { Image } from 'expo-image';
import * as Calendar from 'expo-calendar';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Share from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { RedactionEditor } from '@/components/redaction-editor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { analyzePrintImage, reAnalyzeWithPrompt } from '@/lib/analyze-print';
import { initMobileAds, showInterstitialThen, BANNER_UNIT_ID, isExpoGo } from '@/lib/ads';
import { cropImageByRegion } from '@/lib/crop-image';
import { captureRef } from 'react-native-view-shot';
import { saveDeck } from '@/lib/flashcard-storage';
import { usePremium } from '@/lib/premium-context';
import { Pastel } from '@/constants/theme';
import type {
  AnalyzeResult,
  OshiraseResult,
  TestResult,
  TestProblemItem,
  FlashcardItem,
  SavedDeck,
  RedactionBox,
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
  const [selectedImages, setSelectedImages] = useState<
    { uri: string; base64: string | null; width: number; height: number }[]
  >([]);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [bannerVisible, setBannerVisible] = useState(true);
  const [reParseInput, setReParseInput] = useState('');
  const [reParsing, setReparsing] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [showRedactionEditor, setShowRedactionEditor] = useState(false);
  const [pendingTestResult, setPendingTestResult] = useState<TestResult | null>(null);
  const flattenCaptureRef = useRef<View>(null);
  const router = useRouter();
  const { isPremium } = usePremium();

  useEffect(() => {
    initMobileAds(isPremium).catch(() => {});
  }, [isPremium]);

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
      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) return;
      const asset = pickerResult.assets[0];
      const image = {
        uri: asset.uri,
        base64: asset.base64 ?? null,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
      };
      setSelectedImages([image]);
      setImageUri(image.uri);
      setImageBase64(image.base64);
      setImageWidth(image.width);
      setImageHeight(image.height);
      setResult(null);
      setErrorMessage(null);
      setAnalyzeProgress(null);
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
        allowsMultipleSelection: true,
      });
      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) return;
      const images = pickerResult.assets.map((asset) => ({
        uri: asset.uri,
        base64: asset.base64 ?? null,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
      }));
      setSelectedImages(images);
      const first = images[0];
      setImageUri(first.uri);
      setImageBase64(first.base64);
      setImageWidth(first.width);
      setImageHeight(first.height);
      setResult(null);
      setErrorMessage(null);
      setAnalyzeProgress(null);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'アルバムの読み込みに失敗しました。');
    }
  }, [requestMediaLibraryPermission]);

  const analyzeImage = useCallback(async () => {
    if (!imageUri && selectedImages.length === 0) return;
    setAnalyzing(true);
    setResult(null);
    setErrorMessage(null);
    setAnalyzeProgress(null);

    try {
      const targets =
        selectedImages.length > 0
          ? selectedImages
          : imageUri
          ? [
              {
                uri: imageUri,
                base64: imageBase64,
                width: imageWidth,
                height: imageHeight,
              },
            ]
          : [];

      if (targets.length === 0) {
        throw new Error('解析する画像が選択されていません。');
      }

      const total = targets.length;
      const allProblems: TestProblemItem[] = [];
      const allOshiraseEvents: OshiraseResult['events'] = [];
      const testImageData: { uri: string; base64: string; redaction_boxes: RedactionBox[] }[] = [];
      let oshiraseFullText = '';
      let summaryTitle = '';
      let subject = '';
      let date = '';

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        setAnalyzeProgress({ current: i + 1, total });
        let base64 = target.base64 ?? '';
        if (!base64 || base64.length === 0) {
          base64 = await FileSystemLegacy.readAsStringAsync(target.uri, {
            encoding: FileSystemLegacy.EncodingType.Base64,
          });
        }
        if (!base64 || base64.length === 0) {
          throw new Error('画像の Base64 データを取得できませんでした。');
        }
        const analyzed = await analyzePrintImage(base64, 'image/jpeg');
        if (analyzed.type === 'テスト') {
          const tr = analyzed as TestResult;
          if (!summaryTitle) summaryTitle = tr.summaryTitle ?? '';
          if (!subject) subject = tr.subject ?? '';
          if (!date) date = tr.date ?? '';
          allProblems.push(...tr.problems);
          testImageData.push({
            uri: target.uri,
            base64,
            redaction_boxes: tr.redaction_boxes ?? [],
          });
        } else {
          const osh = analyzed as OshiraseResult;
          allOshiraseEvents.push(...osh.events);
          if (osh.fullText) oshiraseFullText += (oshiraseFullText ? '\n\n' : '') + osh.fullText;
        }
      }

      let finalResult: AnalyzeResult;
      if (allProblems.length > 0) {
        finalResult = {
          type: 'テスト',
          summaryTitle: summaryTitle || testSummaryTitle || 'テスト',
          subject: subject || testSubject || 'その他',
          date: date || testDate || '',
          problems: allProblems,
          testImageData,
        };
      } else if (allOshiraseEvents.length > 0) {
        finalResult = {
          type: 'お知らせ',
          fullText: oshiraseFullText || '（抽出された予定一覧）',
          events: allOshiraseEvents,
        };
      } else {
        throw new Error('解析結果から問題または予定を抽出できませんでした。');
      }

      showInterstitialThen(() => {
        setAnalyzeProgress(null);
        setAnalyzing(false);
        if (finalResult.type === 'テスト' && (finalResult as TestResult).testImageData?.length) {
          setPendingTestResult(finalResult as TestResult);
          setShowRedactionEditor(true);
        } else {
          setResult(finalResult);
        }
      }, isPremium);
    } catch (e) {
      setAnalyzeProgress(null);
      setAnalyzing(false);
      const message = e instanceof Error ? e.message : '解析に失敗しました。';
      setErrorMessage(message);
      Alert.alert('解析エラー', '読み取れませんでした。もう一度お試しください。', [{ text: 'OK' }]);
    }
  }, [
    imageUri,
    imageBase64,
    imageWidth,
    imageHeight,
    selectedImages,
    testSummaryTitle,
    testSubject,
    testDate,
    isPremium,
  ]);

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
        const writableList = calendars.filter((c) => c.allowsModifications);
        if (writableList.length === 0) {
          Alert.alert('エラー', '書き込み可能なカレンダーが見つかりませんでした。');
          return;
        }
        const primaryOrFirst =
          writableList.find((c) => (c as { isPrimary?: boolean }).isPrimary === true) ??
          writableList[0];
        calendarId = primaryOrFirst.id;
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
    if (!imageUri) return;
    try {
      const subject = testSubject.trim() || 'その他';
      setSavingCards(true);
      const cards: FlashcardItem[] = [];
      const w = imageWidth > 0 ? imageWidth : 800;
      const h = imageHeight > 0 ? imageHeight : 600;
      let sourceUri = imageUri;
      const tr = result?.type === 'テスト' ? (result as TestResult) : null;
      const redactionBoxes = tr?.testImageData?.[0]?.redaction_boxes ?? tr?.redaction_boxes ?? [];
      if (redactionBoxes.length > 0 && flattenCaptureRef.current && !isExpoGo()) {
        try {
          const flattenedUri = await new Promise<string>((resolve, reject) => {
            InteractionManager.runAfterInteractions(() => {
              if (!flattenCaptureRef.current) {
                resolve(imageUri);
                return;
              }
              captureRef(flattenCaptureRef.current, {
                format: 'jpg',
                result: 'tmpfile',
                quality: 0.92,
                width: w,
                height: h,
              })
                .then(resolve)
                .catch(reject);
            });
          });
          sourceUri = flattenedUri;
        } catch (e) {
          console.warn('[Flashcards] Flatten capture failed, using original image', e);
        }
      }
      for (const prob of selected) {
        let imageUriOut: string | undefined;
        if (prob.imageRegion) {
          try {
            console.log('[Flashcards] Start cropping for problem', {
              text: prob.text,
              imageRegion: prob.imageRegion,
            });
            imageUriOut = await cropImageByRegion(sourceUri, w, h, prob.imageRegion);
          } catch (e) {
            console.error('[Flashcards] Failed to crop image for problem', {
              text: prob.text,
              imageRegion: prob.imageRegion,
              error: e,
            });
          }
        }
        cards.push({
          question: prob.text,
          answer: prob.correctAnswer,
          explanation: prob.explanation,
          imageUri: imageUriOut,
          imageRegion: prob.imageRegion,
          choices: prob.choices,
          correctAnswer: prob.correctAnswer,
        });
      }
      const now = new Date();
      const deckId = now.getTime().toString();
      const summary = testSummaryTitle.trim();
      const dateStr = testDate.trim();
      let printTitle: string;
      if (summary && dateStr) {
        const normalized = dateStr.includes('/') ? dateStr : dateStr.replace(/-/g, '/');
        printTitle = `${summary} (${normalized})`;
      } else if (summary) {
        printTitle = summary;
      } else {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        printTitle = `${y}/${m}/${d} ${hh}:${min}のプリント`;
      }
      const deck: SavedDeck = {
        deckId,
        printTitle,
        summaryTitle: testSummaryTitle.trim() || 'テスト',
        subject,
        date: testDate.trim(),
        cards,
        savedAt: now.toISOString(),
        redaction_boxes: redactionBoxes.length > 0 ? redactionBoxes : undefined,
      };
      console.log('[Flashcards] Saving deck to AsyncStorage', {
        subject: deck.subject,
        summaryTitle: deck.summaryTitle,
        date: deck.date,
        cardsCount: deck.cards.length,
      });
      await saveDeck(deck);
      Alert.alert(
        '保存しました',
        `${subject} に ${cards.length} 枚のカードを追加しました。\n「単語帳」タブで確認できます。`,
        [
          {
            text: 'OK',
            onPress: () => {
              router.push('/(tabs)/flashcards');
            },
          },
        ]
      );
    } catch (e) {
      console.error('[Flashcards] Failed to save deck', e);
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : 'フラッシュカードの保存に失敗しました。'
      );
    } finally {
      setSavingCards(false);
    }
  }, [selectableProblems, testSubject, testSummaryTitle, testDate, imageUri, imageWidth, imageHeight, result, router]);

  const clearAll = useCallback(() => {
    setImageUri(null);
    setImageBase64(null);
    setImageWidth(0);
    setImageHeight(0);
    setResult(null);
    setErrorMessage(null);
    setEditedEvents([]);
    setSelectableProblems([]);
    setSelectedImages([]);
    setAnalyzeProgress(null);
    setReParseInput('');
    setShowRedactionEditor(false);
    setPendingTestResult(null);
  }, []);

  const handleRedactionComplete = useCallback((editedBoxes: RedactionBox[]) => {
    if (!pendingTestResult?.testImageData?.length) return;
    const updated: TestResult = {
      ...pendingTestResult,
      testImageData: [
        { ...pendingTestResult.testImageData[0], redaction_boxes: editedBoxes },
        ...pendingTestResult.testImageData.slice(1),
      ],
    };
    setResult(updated);
    setShowRedactionEditor(false);
    setPendingTestResult(null);
  }, [pendingTestResult]);

  const generateReviewPdf = useCallback(async () => {
    if (result?.type !== 'テスト') return;
    const tr = result as TestResult;
    setGeneratingPdf(true);
    try {
      let items: { base64: string; redaction_boxes: RedactionBox[] }[] = [];
      if (tr.testImageData?.length) {
        items = tr.testImageData.map((t) => ({ base64: t.base64, redaction_boxes: t.redaction_boxes }));
      } else {
        let base64 = imageBase64 ?? null;
        if (!base64 && selectedImages.length > 0) {
          const first = selectedImages[0];
          base64 = first.base64 ?? null;
          if (!base64 && first.uri) {
            base64 = await FileSystemLegacy.readAsStringAsync(first.uri, {
              encoding: FileSystemLegacy.EncodingType.Base64,
            });
          }
        }
        if (!base64) {
          Alert.alert('エラー', '画像データを取得できません。');
          return;
        }
        items = [{ base64, redaction_boxes: tr.redaction_boxes ?? [] }];
      }
      const pageHtmls = items.map((item, pageIndex) => {
        const imgSrc = `data:image/jpeg;base64,${item.base64}`;
        const overlayDivs = (item.redaction_boxes || [])
          .map(
            (b) =>
              `<div style="position:absolute;left:${b.x_percent}%;top:${b.y_percent}%;width:${b.width_percent}%;height:${b.height_percent}%;background:#fff;"></div>`
          )
          .join('');
        const pageBreak = pageIndex < items.length - 1 ? 'page-break-after:always;' : '';
        return `<div style="position:relative;width:100%;${pageBreak}"><img src="${imgSrc}" style="width:100%;display:block;position:relative;" /><div style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;">${overlayDivs}</div></div>`;
      });
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:0;} @media print { div { page-break-after: always; } div:last-child { page-break-after: auto; } }</style></head><body>${pageHtmls.join('')}</body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      await Share.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: '復習用PDFを保存' });
    } catch (e) {
      Alert.alert(
        'PDFの生成に失敗しました',
        e instanceof Error ? e.message : '不明なエラーです。'
      );
    } finally {
      setGeneratingPdf(false);
    }
  }, [result, imageBase64, selectedImages]);

  const submitReParse = useCallback(async () => {
    const prompt = reParseInput.trim();
    if (!prompt) return;
    let base64 = imageBase64 ?? null;
    if (!base64 && selectedImages.length > 0) {
      const first = selectedImages[0];
      base64 = first.base64 ?? null;
      if (!base64 && first.uri) {
        try {
          base64 = await FileSystemLegacy.readAsStringAsync(first.uri, {
            encoding: FileSystemLegacy.EncodingType.Base64,
          });
        } catch {
          setErrorMessage('画像データの取得に失敗しました。');
          return;
        }
      }
    }
    if (!base64) {
      setErrorMessage('再解析する画像がありません。');
      return;
    }
    setReparsing(true);
    setErrorMessage(null);
    try {
      const newResult = await reAnalyzeWithPrompt(base64, 'image/jpeg', prompt);
      setResult(newResult);
      setReParseInput('');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '再解析に失敗しました。');
    } finally {
      setReparsing(false);
    }
  }, [reParseInput, imageBase64, selectedImages]);

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
    if (isPremium || !bannerVisible) return null;
    if (isExpoGo()) {
      return (
        <View style={styles.bannerPlaceholder}>
          <Text style={styles.bannerPlaceholderText}>広告エリア (テスト用)</Text>
        </View>
      );
    }
    try {
      const ads = require('react-native-google-mobile-ads');
      const Banner = ads.BannerAd;
      const size = ads.BannerAdSize?.ANCHORED_ADAPTIVE_BANNER ?? ads.BannerAdSize?.BANNER ?? 'BANNER';
      const unitId = BANNER_UNIT_ID ?? '';
      return (
        <View style={styles.bannerWrapper}>
          <Banner
            unitId={unitId}
            size={size}
            requestOptions={{ requestNonPersonalizedAdsOnly: false }}
            onAdLoaded={() => {}}
            onAdFailedToLoad={() => {
              console.error('[Ads] Banner failed to load - hiding banner');
              setBannerVisible(false);
            }}
          />
        </View>
      );
    } catch (e) {
      console.warn('[Ads] Failed to render banner - showing placeholder', e);
      return (
        <View style={styles.bannerPlaceholder}>
          <Text style={styles.bannerPlaceholderText}>広告エリア (テスト用)</Text>
        </View>
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ThemedView style={styles.container}>
          <View style={styles.mainLayout}>
            <ScrollView
              style={styles.topSection}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
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
              <View style={[styles.previewContainer, result?.type === 'テスト' && imageWidth && imageHeight && { aspectRatio: imageWidth / imageHeight }]}>
                <Image source={{ uri: imageUri }} style={styles.previewImage} contentFit="contain" />
                {result?.type === 'テスト' && (() => {
                  const tr = result as TestResult;
                  const boxes = tr.testImageData?.[0]?.redaction_boxes ?? tr.redaction_boxes ?? [];
                  if (boxes.length === 0) return null;
                  return (
                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                      {boxes.map((b, i) => (
                        <View
                          key={i}
                          style={[
                            styles.redactionOverlay,
                            {
                              left: `${b.x_percent}%`,
                              top: `${b.y_percent}%`,
                              width: `${b.width_percent}%`,
                              height: `${b.height_percent}%`,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  );
                })()}
              </View>
              {result?.type === 'テスト' && imageUri && imageWidth > 0 && imageHeight > 0 && (() => {
                const tr = result as TestResult;
                const boxes = tr.testImageData?.[0]?.redaction_boxes ?? tr.redaction_boxes ?? [];
                return (
                  <View
                    ref={flattenCaptureRef}
                    style={[
                      styles.flattenCaptureView,
                      {
                        width: imageWidth,
                        height: imageHeight,
                      },
                    ]}
                    collapsable={false}
                  >
                    <Image
                      source={{ uri: imageUri }}
                      style={StyleSheet.absoluteFill}
                      contentFit="contain"
                    />
                    {boxes.map((b, i) => (
                      <View
                        key={i}
                        style={[
                          styles.flattenRedactionOverlay,
                          {
                            left: `${b.x_percent}%`,
                            top: `${b.y_percent}%`,
                            width: `${b.width_percent}%`,
                            height: `${b.height_percent}%`,
                          },
                        ]}
                      />
                    ))}
                  </View>
                );
              })()}
              <TouchableOpacity
                style={[styles.analyzeButton, analyzing && styles.analyzeButtonDisabled]}
                onPress={analyzeImage}
                disabled={analyzing}
                activeOpacity={0.8}
              >
                {analyzing ? (
                  <View style={styles.analyzeInner}>
                    <ActivityIndicator color="#fff" style={styles.analyzeSpinner} />
                    <ThemedText style={styles.analyzeButtonText}>
                      AIが解析中...（完了後に広告が出ます）
                    </ThemedText>
                  </View>
                ) : (
                  <ThemedText style={styles.analyzeButtonText}>解析する</ThemedText>
                )}
              </TouchableOpacity>
              {isPremium ? (
                <View style={styles.premiumStatusBox}>
                  <ThemedText style={styles.premiumStatusIcon}>✨</ThemedText>
                  <ThemedText style={styles.premiumStatusText}>プレミアム会員（広告非表示）</ThemedText>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.premiumCtaButton}
                  onPress={() => router.push('/(tabs)/explore')}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.premiumCtaIcon}>✨</ThemedText>
                  <ThemedText style={styles.premiumCtaText}>広告を非表示にする（月額200円）</ThemedText>
                </TouchableOpacity>
              )}
              <ThemedText style={styles.noticeText}>
                ※AIが複数枚のプリントを全力で解析するため、数十秒かかります。処理完了後、結果を見る前にスポンサー広告が表示されます🙇‍♀️
              </ThemedText>
              {analyzeProgress ? (
                <View style={styles.progressBox}>
                  <ThemedText style={styles.progressText}>
                    現在 {analyzeProgress.current} / {analyzeProgress.total} 枚目を読み込み中...
                  </ThemedText>
                </View>
              ) : null}
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
                  <TouchableOpacity
                    style={[styles.pdfButton, generatingPdf && styles.analyzeButtonDisabled]}
                    onPress={generateReviewPdf}
                    disabled={generatingPdf}
                    activeOpacity={0.8}
                  >
                    {generatingPdf ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <ThemedText style={styles.pdfButtonText}>
                        📄 復習用PDFを出力（解答を隠す）
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                  <ThemedText style={styles.imageNote}>
                    「単語帳」タブでカードをめくって暗記できます。図形がある問題は画像で保存されます。
                  </ThemedText>
                </View>
              )}
              <View style={styles.reParseBox}>
                <ThemedText style={styles.reParseLabel}>再解析の指示（AIに追加指示を送る）</ThemedText>
                <TextInput
                  style={styles.reParseInput}
                  value={reParseInput}
                  onChangeText={setReParseInput}
                  placeholder="例：イベント名は『○○：～～』の形式に統一して"
                  placeholderTextColor="#999"
                  multiline
                  numberOfLines={2}
                  editable={!reParsing}
                />
                <TouchableOpacity
                  style={[styles.reParseButton, reParsing && styles.analyzeButtonDisabled]}
                  onPress={submitReParse}
                  disabled={reParsing}
                  activeOpacity={0.8}
                >
                  {reParsing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <ThemedText style={styles.reParseButtonText}>再解析を送信</ThemedText>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
            {renderBanner()}
          </ScrollView>
          {!imageUri && !result ? (
            <View style={styles.bottomSection}>
              <ScrollView
                style={styles.explanationScroll}
                contentContainerStyle={styles.explanationScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.explanationCard}>
                  <Text style={styles.explanationTitle}>
                    📷 パシャっとプリント管理でできること
                  </Text>
                  <View style={styles.explanationItem}>
                    <Text style={styles.explanationBullet}>📅 お知らせプリント</Text>
                    <Text style={styles.explanationBody}>→ カレンダー登録＆通知設定！</Text>
                    <Text style={styles.explanationSub}>
                      （机の上の写真やスマホのスクショでもOK）
                    </Text>
                  </View>
                  <View style={styles.explanationItem}>
                    <Text style={styles.explanationBullet}>🍲 献立表</Text>
                    <Text style={styles.explanationBody}>→ カレンダーに自動登録！</Text>
                    <Text style={styles.explanationSub}>
                      （給食と夕飯のメニュー被りを防ぎます）
                    </Text>
                  </View>
                  <View style={styles.explanationItem}>
                    <Text style={styles.explanationBullet}>💯 テスト</Text>
                    <Text style={styles.explanationBody}>→ クイズや暗記カードに！</Text>
                    <Text style={styles.explanationSub}>
                      （解答を自動で隠した「復習用PDF」の出力も可能📄）
                    </Text>
                  </View>
                  <Text style={styles.explanationNote}>
                    ※完全無料（画像処理後に広告あり）。設定画面から広告なしのプレミアムプランも選べます。
                  </Text>
                </View>
              </ScrollView>
            </View>
          ) : null}
        </View>
        {savingCards && (
          <View style={styles.fullscreenOverlay}>
            <View style={styles.fullscreenOverlayInner}>
              <ActivityIndicator size="large" color="#fff" />
              <ThemedText style={styles.fullscreenOverlayText}>
                フラッシュカードを保存しています...
              </ThemedText>
            </View>
          </View>
        )}
        {renderBanner()}
        </ThemedView>
      </KeyboardAvoidingView>
      {pendingTestResult?.testImageData?.[0] && (
        <RedactionEditor
          visible={showRedactionEditor}
          imageUri={pendingTestResult.testImageData[0].uri}
          imageWidth={imageWidth || 800}
          imageHeight={imageHeight || 600}
          initialBoxes={pendingTestResult.testImageData[0].redaction_boxes}
          onComplete={handleRedactionComplete}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Pastel.cream,
  },
  container: {
    flex: 1,
    backgroundColor: Pastel.cream,
  },
  mainLayout: {
    flex: 1,
    flexDirection: 'column',
  },
  topSection: {
    flex: 1,
  },
  bottomSection: {
    flex: 2,
    minHeight: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  explanationScroll: {
    flex: 1,
  },
  explanationScrollContent: {
    flexGrow: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 20,
  },
  explanationCard: {
    flex: 1,
    backgroundColor: Pastel.cardFront,
    borderRadius: Pastel.borderRadius,
    borderWidth: 1,
    borderColor: Pastel.coral,
    padding: 18,
    ...Pastel.shadowStyle,
  },
  explanationTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Pastel.coralStrong,
    marginBottom: 14,
    textAlign: 'center',
  },
  explanationItem: {
    marginBottom: 14,
  },
  explanationBullet: {
    fontSize: 15,
    fontWeight: '600',
    color: Pastel.coralStrong,
  },
  explanationBody: {
    fontSize: 14,
    color: '#333',
    marginTop: 2,
  },
  explanationSub: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
    lineHeight: 18,
  },
  explanationNote: {
    fontSize: 11,
    color: '#888',
    lineHeight: 16,
    marginTop: 8,
  },
  title: {
    marginBottom: 8,
    color: Pastel.coralStrong,
  },
  subtitle: {
    marginBottom: 24,
    opacity: 0.9,
    color: Pastel.coralStrong,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Pastel.borderRadiusButton,
    alignItems: 'center',
    justifyContent: 'center',
    ...Pastel.shadowStyle,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: 'rgba(199, 92, 92, 0.12)',
    padding: 12,
    borderRadius: Pastel.borderRadiusButton,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(199, 92, 92, 0.3)',
  },
  errorText: {
    color: Pastel.error,
    fontSize: 14,
  },
  previewContainer: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: Pastel.creamDark,
    borderRadius: Pastel.borderRadius,
    overflow: 'hidden',
    marginBottom: 16,
    ...Pastel.shadowStyle,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  redactionOverlay: {
    position: 'absolute',
    backgroundColor: '#fff',
  },
  flattenCaptureView: {
    position: 'absolute',
    left: -10000,
    overflow: 'hidden',
  },
  flattenRedactionOverlay: {
    position: 'absolute',
    backgroundColor: '#fff',
  },
  analyzeButton: {
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 14,
    borderRadius: Pastel.borderRadiusButton,
    alignItems: 'center',
    marginBottom: 12,
    ...Pastel.shadowStyle,
  },
  analyzeButtonDisabled: {
    opacity: 0.7,
  },
  analyzeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  analyzeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  analyzeSpinner: {
    marginRight: 6,
  },
  premiumStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: Pastel.borderRadiusButton,
    backgroundColor: Pastel.pink,
    borderWidth: 1,
    borderColor: Pastel.coral,
  },
  premiumStatusIcon: {
    fontSize: 18,
  },
  premiumStatusText: {
    fontSize: 14,
    fontWeight: '600',
    color: Pastel.coralStrong,
  },
  premiumCtaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: Pastel.borderRadiusButton,
    backgroundColor: Pastel.peach,
    borderWidth: 1,
    borderColor: Pastel.coral,
    ...Pastel.shadowStyle,
  },
  premiumCtaIcon: {
    fontSize: 18,
  },
  premiumCtaText: {
    fontSize: 14,
    fontWeight: '600',
    color: Pastel.coralStrong,
  },
  clearButton: {
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 24,
  },
  clearButtonText: {
    fontSize: 14,
    color: Pastel.coralStrong,
  },
  resultContainer: {
    marginTop: 8,
    padding: 16,
    borderRadius: Pastel.borderRadius,
    borderWidth: 1,
    borderColor: Pastel.coral,
    backgroundColor: Pastel.cardFront,
    ...Pastel.shadowStyle,
  },
  resultTitle: {
    marginBottom: 12,
    color: Pastel.coralStrong,
  },
  resultLabel: {
    fontSize: 12,
    opacity: 0.85,
    marginTop: 8,
    marginBottom: 2,
    color: Pastel.coralStrong,
  },
  oshiraseBox: {
    marginTop: 4,
  },
  eventCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: Pastel.borderRadius,
    backgroundColor: Pastel.pink,
    borderWidth: 1,
    borderColor: Pastel.coral,
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
    borderColor: Pastel.coralStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkboxChecked: {
    backgroundColor: Pastel.coralStrong,
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
    color: Pastel.coralStrong,
  },
  input: {
    borderWidth: 1,
    borderColor: Pastel.coral,
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
    borderColor: Pastel.coralStrong,
  },
  reminderButtonActive: {
    backgroundColor: Pastel.coralStrong,
  },
  reminderButtonText: {
    fontSize: 12,
    color: Pastel.coralStrong,
  },
  reminderButtonTextActive: {
    color: '#fff',
  },
  shareButton: {
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: Pastel.borderRadius,
    alignItems: 'center',
    marginTop: 8,
    ...Pastel.shadowStyle,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  pdfButton: {
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Pastel.borderRadiusButton,
    alignItems: 'center',
    marginTop: 12,
    ...Pastel.shadowStyle,
  },
  pdfButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  imageNote: {
    fontSize: 11,
    opacity: 0.8,
    marginTop: 8,
    color: Pastel.coralStrong,
  },
  testBox: {
    marginTop: 4,
  },
  problemCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: Pastel.borderRadius,
    backgroundColor: Pastel.cardFront,
    borderWidth: 1,
    borderColor: Pastel.coral,
  },
  problemText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#333',
    marginTop: 4,
  },
  figureNote: {
    fontSize: 11,
    color: Pastel.coralStrong,
    marginTop: 4,
  },
  noticeText: {
    marginTop: 4,
    fontSize: 11,
    color: Pastel.coralStrong,
    lineHeight: 16,
  },
  progressBox: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: Pastel.pink,
  },
  progressText: {
    fontSize: 12,
    color: Pastel.coralStrong,
  },
  reParseBox: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Pastel.coral,
  },
  reParseLabel: {
    fontSize: 12,
    marginBottom: 8,
    color: Pastel.coralStrong,
  },
  reParseInput: {
    borderWidth: 1,
    borderColor: Pastel.coral,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    minHeight: 56,
    textAlignVertical: 'top',
  },
  reParseButton: {
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 12,
    borderRadius: Pastel.borderRadiusButton,
    alignItems: 'center',
    marginTop: 10,
  },
  reParseButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  bannerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: Pastel.creamDark,
  },
  bannerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: '#ccc',
    minHeight: 52,
  },
  bannerPlaceholderText: {
    fontSize: 12,
    color: '#666',
  },
  fullscreenOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  fullscreenOverlayInner: {
    paddingVertical: 24,
    paddingHorizontal: 32,
    borderRadius: Pastel.borderRadius,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    alignItems: 'center',
  },
  fullscreenOverlayText: {
    marginTop: 12,
    color: '#fff',
    fontSize: 15,
  },
});
