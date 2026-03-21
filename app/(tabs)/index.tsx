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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useRouter } from 'expo-router';

import { RedactionEditor } from '@/components/redaction-editor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { analyzePrintFromText, analyzePrintImage, reAnalyzeWithPrompt } from '@/lib/analyze-print';
import { initMobileAds, showInterstitialThen, BANNER_UNIT_ID, isExpoGo } from '@/lib/ads';
import { notifyCalendarRegistrationComplete } from '@/lib/calendar-notification';
import { createCalendarEvent, type CreateEventPayload } from '@/lib/google-calendar-api';
import {
  addOrUpdateLinkedAccount,
  getValidLinkedAccounts,
  getLinkedAccounts,
  removeLinkedAccount,
  type ValidLinkedAccount,
  type StoredAccount,
} from '@/lib/google-oauth-storage';
import { fetchGoogleUserEmail } from '@/lib/google-userinfo';
import { cropImageByRegion } from '@/lib/crop-image';
import { captureRef } from 'react-native-view-shot';
import { saveDeck } from '@/lib/flashcard-storage';
import { recordSuccessAndMaybeRequestReview } from '@/lib/store-review-milestone';
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

/** Google Calendar の既定色 + 標準イベントカラー11色（計12色）。隣同士が似た色にならないよう並び替え */
const GOOGLE_CALENDAR_COLORS: { id: string; label: string; hex: string }[] = [
  { id: '0', label: '既定', hex: '#4285F4' },
  { id: '11', label: 'トマト', hex: '#D50000' },
  { id: '5', label: 'バナナ', hex: '#F6BF26' },
  { id: '2', label: 'セージ', hex: '#33B679' },
  { id: '3', label: 'グレープ', hex: '#8E24AA' },
  { id: '6', label: 'みかん', hex: '#F4511E' },
  { id: '7', label: 'ピーコック', hex: '#039BE5' },
  { id: '10', label: 'バジル', hex: '#0B8043' },
  { id: '4', label: 'フラミンゴ', hex: '#E67C73' },
  { id: '1', label: 'ラベンダー', hex: '#7986CB' },
  { id: '8', label: 'グラファイト', hex: '#616161' },
  { id: '9', label: 'ブルーベリー', hex: '#3F51B5' },
];

/** 編集可能なお知らせ1件（選択状態含む） */
interface EditableOshiraseItem {
  eventName: string;
  eventDate: string;
  endDate: string;
  memo: string;
  selected: boolean;
  useCustomSettings: boolean;
  customColor: string;
  customMainReminder: 'none' | number;
  customBackupReminder: 'none' | number;
  /** 終日イベントとして登録する */
  isAllDay: boolean;
}

/** テスト問題の選択状態付き */
interface SelectableProblem extends TestProblemItem {
  selected: boolean;
}

function defaultEndDate(startISO: string): string {
  const d = safeParseDate(startISO);
  if (!d) return '';
  d.setHours(d.getHours() + 1);
  return dateToLocalISO(d);
}

/** ISO文字列をDateに変換（不正値はnullを返す） */
function safeParseDate(iso: string): Date | null {
  if (!iso || !iso.trim()) return null;
  const text = iso.trim();
  const localIso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (localIso) {
    const year = Number(localIso[1]);
    const month = Number(localIso[2]);
    const day = Number(localIso[3]);
    const hour = Number(localIso[4]);
    const minute = Number(localIso[5]);
    const second = Number(localIso[6] ?? '0');
    const d = new Date(year, month - 1, day, hour, minute, second, 0);
    if (
      d.getFullYear() === year &&
      d.getMonth() === month - 1 &&
      d.getDate() === day &&
      d.getHours() === hour &&
      d.getMinutes() === minute
    ) {
      return d;
    }
    return null;
  }
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

/** 終了日時が開始日時より前なら開始の1時間後に自動補正 */
function fixEndDateIfBefore(startISO: string, endISO: string): string {
  const s = safeParseDate(startISO);
  const e = safeParseDate(endISO);
  if (!s || !e) return endISO;
  if (e.getTime() <= s.getTime()) {
    const fixed = new Date(s);
    fixed.setHours(fixed.getHours() + 1);
    return dateToLocalISO(fixed);
  }
  return endISO;
}

/** DateオブジェクトからISO的な文字列 (YYYY-MM-DDTHH:MM:SS) を返す */
function dateToLocalISO(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

/** 終日用: その日の 00:00 のISO文字列 */
function dateToStartOfDayISO(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T00:00:00`;
}

/** 終日用: その日の 23:59 のISO文字列 */
function dateToEndOfDayISO(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T23:59:00`;
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

/* ================================================================
 *  DateTimePickerModal — 年・月・日・時・分を ▲▼ ボタンで選択
 *  スクロール不使用のため iOS/Android ともに安定動作。
 * ================================================================ */

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

interface DateTimePickerModalProps {
  visible: boolean;
  value: Date;
  onConfirm: (d: Date) => void;
  onCancel: () => void;
  title?: string;
}

function SpinnerCol({ value, min, max, onChange, suffix, width, pad }: {
  value: number; min: number; max: number;
  onChange: (v: number) => void; suffix: string; width: number; pad?: number;
}) {
  const wrap = (v: number) => (v < min ? max : v > max ? min : v);
  return (
    <View style={[pkS.col, { width }]}>
      <TouchableOpacity style={pkS.arrow} onPress={() => onChange(wrap(value + 1))} activeOpacity={0.6}>
        <Text style={pkS.arrowText}>▲</Text>
      </TouchableOpacity>
      <View style={pkS.valBox}>
        <Text style={pkS.valText}>
          {String(value).padStart(pad ?? 2, '0')}
        </Text>
        <Text style={pkS.suffixText}>{suffix}</Text>
      </View>
      <TouchableOpacity style={pkS.arrow} onPress={() => onChange(wrap(value - 1))} activeOpacity={0.6}>
        <Text style={pkS.arrowText}>▼</Text>
      </TouchableOpacity>
    </View>
  );
}

function DateTimePickerModal({ visible, value, onConfirm, onCancel, title }: DateTimePickerModalProps) {
  const [year, setYear] = useState(value.getFullYear());
  const [month, setMonth] = useState(value.getMonth() + 1);
  const [day, setDay] = useState(value.getDate());
  const [hour, setHour] = useState(value.getHours());
  const [minute, setMinute] = useState(Math.floor(value.getMinutes() / 5) * 5);

  useEffect(() => {
    if (visible) {
      setYear(value.getFullYear());
      setMonth(value.getMonth() + 1);
      setDay(value.getDate());
      setHour(value.getHours());
      setMinute(Math.floor(value.getMinutes() / 5) * 5);
    }
  }, [visible, value]);

  const maxDay = useMemo(() => daysInMonth(year, month), [year, month]);
  useEffect(() => { if (day > maxDay) setDay(maxDay); }, [maxDay, day]);

  const setMinuteWrap = useCallback((v: number) => {
    if (v < 0) setMinute(55);
    else if (v > 55) setMinute(0);
    else setMinute(v);
  }, []);

  const handleConfirm = () => {
    onConfirm(new Date(year, month - 1, Math.min(day, maxDay), hour, minute, 0));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity style={pkS.backdrop} activeOpacity={1} onPress={onCancel}>
        <View style={pkS.container} onStartShouldSetResponder={() => true}>
          <Text style={pkS.title}>{title || '日時を選択'}</Text>

          <View style={pkS.dateRow}>
            <SpinnerCol value={year} min={2024} max={2034} onChange={setYear} suffix="年" width={68} pad={4} />
            <SpinnerCol value={month} min={1} max={12} onChange={setMonth} suffix="月" width={50} />
            <SpinnerCol value={Math.min(day, maxDay)} min={1} max={maxDay} onChange={setDay} suffix="日" width={50} />
          </View>

          <View style={pkS.timeRow}>
            <SpinnerCol value={hour} min={0} max={23} onChange={setHour} suffix="時" width={50} />
            <Text style={pkS.timeSep}>:</Text>
            <SpinnerCol value={minute} min={0} max={55} onChange={setMinuteWrap} suffix="分" width={50} />
          </View>

          <View style={pkS.preview}>
            <Text style={pkS.previewText}>
              {year}/{String(month).padStart(2, '0')}/{String(Math.min(day, maxDay)).padStart(2, '0')} {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
            </Text>
          </View>

          <View style={pkS.btnRow}>
            <TouchableOpacity style={pkS.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
              <Text style={pkS.cancelBtnText}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={pkS.confirmBtn} onPress={handleConfirm} activeOpacity={0.8}>
              <Text style={pkS.confirmBtnText}>決定</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const pkS = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  container: { backgroundColor: '#fff', borderRadius: 20, paddingVertical: 20, paddingHorizontal: 16, width: '88%', maxWidth: 340, alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 16 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 12 },
  timeSep: { fontSize: 22, fontWeight: '700', color: '#c97b63', marginHorizontal: 2, paddingBottom: 4 },
  col: { alignItems: 'center' },
  arrow: { paddingVertical: 6, paddingHorizontal: 12 },
  arrowText: { fontSize: 18, color: '#c97b63', fontWeight: '600' },
  valBox: { flexDirection: 'row', alignItems: 'baseline', backgroundColor: 'rgba(201,123,99,0.10)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6, minWidth: 44, justifyContent: 'center' },
  valText: { fontSize: 20, fontWeight: '700', color: '#c97b63' },
  suffixText: { fontSize: 11, color: '#999', marginLeft: 1 },
  preview: { backgroundColor: '#f8f0ec', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16, marginBottom: 16 },
  previewText: { fontSize: 16, fontWeight: '600', color: '#333', letterSpacing: 0.5 },
  btnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: '#ccc', alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: '#888', fontWeight: '600' },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: '#c97b63', alignItems: 'center' },
  confirmBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});

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
  const [bannerReloadToken, setBannerReloadToken] = useState(0);
  const [adsReady, setAdsReady] = useState(false);
  const [reParseInput, setReParseInput] = useState('');
  const [reParsing, setReparsing] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [showRedactionEditor, setShowRedactionEditor] = useState(false);
  const [pendingTestResult, setPendingTestResult] = useState<TestResult | null>(null);
  const [calendarColor, setCalendarColor] = useState(GOOGLE_CALENDAR_COLORS[0].hex);
  const [isGlobalSettingsEnabled, setIsGlobalSettingsEnabled] = useState(false);
  const [useDeviceCalendar, setUseDeviceCalendar] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<StoredAccount[]>([]);
  const [selectedLinkedEmails, setSelectedLinkedEmails] = useState<string[]>([]);
  const [loadingGoogleAuth, setLoadingGoogleAuth] = useState(false);
  const [notifyOnCalendarComplete, setNotifyOnCalendarComplete] = useState(false);
  const [showGoogleConsentModal, setShowGoogleConsentModal] = useState(false);
  const [showPasteTextModal, setShowPasteTextModal] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [analyzingText, setAnalyzingText] = useState(false);
  const [dtPickerVisible, setDtPickerVisible] = useState(false);
  const [dtPickerTarget, setDtPickerTarget] = useState<{ index: number; field: 'eventDate' | 'endDate' }>({ index: 0, field: 'eventDate' });
  const flattenCaptureRef = useRef<View>(null);
  const bannerRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { isPremium } = usePremium();

  const googleSignInReady = useMemo(() => {
    if (Platform.OS === 'web') return false;
    return Boolean(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB?.trim());
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB?.trim();
    if (!webClientId) {
      console.error(
        '[Google Sign-In] EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB が未設定です。EAS の環境変数を確認してください。'
      );
      return;
    }
    const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS?.trim();
    GoogleSignin.configure({
      webClientId,
      scopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/calendar',
      ],
      ...(Platform.OS === 'ios' && iosClientId ? { iosClientId } : {}),
    });
  }, []);

  const runGoogleLinkFlow = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert('未対応', 'この環境では Google カレンダー連携は利用できません。');
      return;
    }
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB?.trim();
    if (!webClientId) {
      Alert.alert('設定エラー', 'Google Web Client ID が未設定です。ビルド設定を確認してください。');
      return;
    }
    setLoadingGoogleAuth(true);
    try {
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }
      // 毎回 Account Picker を出す: キャッシュトークン解除 → signOut で SDK 内の既定アカウントを消してから signIn
      try {
        const cached = await GoogleSignin.getTokens();
        if (cached?.accessToken && Platform.OS === 'android') {
          await GoogleSignin.clearCachedAccessToken(cached.accessToken);
        }
      } catch {
        /* 未サインインなど */
      }
      try {
        await GoogleSignin.signOut();
      } catch {
        /* 未サインイン・既にクリア済みでも続行 */
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      const signInResult = await GoogleSignin.signIn();
      if (signInResult.type !== 'success') {
        return;
      }
      const tokens = await GoogleSignin.getTokens();
      const accessToken = tokens.accessToken;
      const email = await fetchGoogleUserEmail(accessToken);
      const issuedAt = Math.floor(Date.now() / 1000);
      await addOrUpdateLinkedAccount({
        email,
        accessToken,
        issuedAt,
        expiresIn: 3600,
      });
      const all = await getLinkedAccounts();
      setLinkedAccounts(all);
      setSelectedLinkedEmails((prev) => (prev.includes(email) ? prev : [...prev, email]));
    } catch (e) {
      console.warn('[Calendar] Google Sign-In failed', e);
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : '連携の処理に失敗しました。'
      );
    } finally {
      setLoadingGoogleAuth(false);
    }
  }, []);

  const hasRestoredLinkedAccountsRef = useRef(false);
  useEffect(() => {
    if (hasRestoredLinkedAccountsRef.current) return;
    hasRestoredLinkedAccountsRef.current = true;
    getLinkedAccounts()
      .then((all) => {
        if (all.length === 0) return;
        setLinkedAccounts(all);
        setSelectedLinkedEmails(all.map((a) => a.email));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    console.log('[Ads] initMobileAds called. isPremium=', isPremium);
    let cancelled = false;
    initMobileAds(isPremium)
      .then(() => {
        if (!cancelled) {
          console.log('[Ads] SDK ready, enabling banner');
          setAdsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAdsReady(true);
      });
    return () => { cancelled = true; };
  }, [isPremium]);

  useEffect(() => {
    return () => {
      if (bannerRetryTimerRef.current) {
        clearTimeout(bannerRetryTimerRef.current);
        bannerRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (result?.type === 'お知らせ') {
      const events = (result as OshiraseResult).events;
      const today = new Date();
      const todayStart = dateToStartOfDayISO(today);
      const todayEnd = dateToEndOfDayISO(today);
      setEditedEvents(
        events.map((e) => {
          const dateUnknown = !e.eventDate || !safeParseDate(e.eventDate);
          const startISO = dateUnknown ? todayStart : e.eventDate;
          const rawEnd = e.eventEndDate ?? (dateUnknown ? todayEnd : defaultEndDate(e.eventDate));
          const endDate = fixEndDateIfBefore(startISO, rawEnd);
          return {
            eventName: e.eventName,
            eventDate: startISO,
            endDate,
            memo: e.memo ?? '',
            selected: true,
            useCustomSettings: false,
            customColor: GOOGLE_CALENDAR_COLORS[0].hex,
            customMainReminder: 'none' as const,
            customBackupReminder: 'none' as const,
            isAllDay: dateUnknown,
          };
        })
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
    if (analyzing) return;
    if (!imageUri && selectedImages.length === 0) return;

    setAnalyzing(true);
    setResult(null);
    setErrorMessage(null);
    setAnalyzeProgress(null);

    let finalResult: AnalyzeResult | null = null;
    let analysisDone = false;
    let adDone = false;

    const finishIfReady = () => {
      if (!analysisDone || !adDone || !finalResult) return;
      setAnalyzeProgress(null);
      setAnalyzing(false);
      if (finalResult.type === 'テスト' && (finalResult as TestResult).testImageData?.length) {
        setPendingTestResult(finalResult as TestResult);
        setShowRedactionEditor(true);
      } else {
        setResult(finalResult);
      }
      void recordSuccessAndMaybeRequestReview();
    };

    const runParse = async () => {
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
        analysisDone = true;
        finishIfReady();
      } catch (e) {
        setAnalyzeProgress(null);
        setAnalyzing(false);
        const message = e instanceof Error ? e.message : '解析に失敗しました。';
        setErrorMessage(message);
        Alert.alert('解析エラー', '読み取れませんでした。もう一度お試しください。', [{ text: 'OK' }]);
      }
    };

    // 解析処理をバックグラウンドで開始
    runParse();

    // すぐにインタースティシャル広告を表示（閉じたら finishIfReady を確認）
    showInterstitialThen(() => {
      adDone = true;
      finishIfReady();
    }, isPremium);
  }, [
    analyzing,
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

  const updateEditedEvent = useCallback((index: number, field: keyof EditableOshiraseItem, value: string | boolean | number) => {
    setEditedEvents((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value };
        if (field === 'eventDate' && typeof value === 'string') {
          updated.endDate = fixEndDateIfBefore(value, updated.endDate);
        }
        if (field === 'endDate' && typeof value === 'string') {
          updated.endDate = fixEndDateIfBefore(updated.eventDate, value);
        }
        if (field === 'isAllDay' && value === true) {
          const d = safeParseDate(item.eventDate) || new Date();
          updated.eventDate = dateToStartOfDayISO(d);
          updated.endDate = dateToEndOfDayISO(d);
        }
        return updated;
      })
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

  const openDateTimePicker = useCallback((index: number, field: 'eventDate' | 'endDate') => {
    setDtPickerTarget({ index, field });
    setDtPickerVisible(true);
  }, []);

  const handleDateTimePicked = useCallback((d: Date) => {
    setDtPickerVisible(false);
    const iso = dateToLocalISO(d);
    updateEditedEvent(dtPickerTarget.index, dtPickerTarget.field, iso);
  }, [dtPickerTarget, updateEditedEvent]);

  /** 1回の登録完了後に呼ぶ。選択状態のみリセット（連携アカウントは残す）。 */
  const cleanupCalendarStateAfterRegistration = useCallback(() => {
    setSelectedLinkedEmails(linkedAccounts.map((a) => a.email));
  }, [linkedAccounts]);

  /** 端末の標準カレンダーIDを取得（iOS: デフォルト / Android: ローカルプライマリ） */
  const getDeviceCalendarId = useCallback(async (): Promise<string | null> => {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') return null;
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.filter((c) => c.allowsModifications);
    if (writable.length === 0) return null;
    if (Platform.OS === 'ios') {
      try {
        const def = await Calendar.getDefaultCalendarAsync();
        return def?.id ?? writable[0]?.id ?? null;
      } catch {
        const local = writable.find((c) => c.source?.type === 'local') ?? writable[0];
        return local?.id ?? null;
      }
    }
    const primary = writable.find((c) => (c as { isPrimary?: boolean }).isPrimary === true);
    if (primary) return primary.id;
    const local = writable.find((c) => c.source?.type === 'local');
    return (local ?? writable[0])?.id ?? null;
  }, []);

  const addToCalendar = useCallback(async () => {
    const selectedItems = editedEvents.filter((e) => e.selected);
    if (selectedItems.length === 0) {
      Alert.alert('確認', 'カレンダーに登録する予定を1件以上選択してください。');
      return;
    }

    for (const item of selectedItems) {
      const s = safeParseDate(item.eventDate);
      const e = safeParseDate(item.endDate);
      if (!s) {
        Alert.alert('日時エラー', `「${item.eventName || '（無題）'}」の開始日時が正しくありません。`);
        return;
      }
      if (!e) {
        Alert.alert('日時エラー', `「${item.eventName || '（無題）'}」の終了日時が正しくありません。`);
        return;
      }
      if (e.getTime() <= s.getTime()) {
        Alert.alert('日時エラー', `「${item.eventName || '（無題）'}」の終了日時が開始日時より前になっています。終了日時を修正してください。`);
        return;
      }
    }

    if (!useDeviceCalendar && selectedLinkedEmails.length === 0) {
      Alert.alert('確認', '登録先に「端末の標準カレンダー」または「Googleカレンダー」を1つ以上選択してください。');
      return;
    }

    const fullText =
      result && result.type === 'お知らせ' ? (result as OshiraseResult).fullText : '';
    const fullTextSuffix = fullText ? FULLTEXT_HEADER + fullText : '';
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

    type Task = () => Promise<void>;
    const tasks: Task[] = [];

    if (useDeviceCalendar) {
      const deviceCalId = await getDeviceCalendarId();
      if (!deviceCalId) {
        Alert.alert('カレンダーの許可', '端末のカレンダーに追加するには、設定でカレンダーへのアクセスを許可してください。', [{ text: 'OK' }]);
        return;
      }
      for (const item of selectedItems) {
        const startDate = safeParseDate(item.eventDate)!;
        let endDate = safeParseDate(item.endDate)!;
        if (item.isAllDay) {
          endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 1);
          endDate.setHours(0, 0, 0, 0);
        }
        const effectiveMain = isGlobalSettingsEnabled ? mainReminder : item.customMainReminder;
        const effectiveBackup = isGlobalSettingsEnabled ? backupReminder : item.customBackupReminder;
        const reminderMinutes = [effectiveMain, effectiveBackup]
          .filter((x): x is number => x !== 'none')
          .slice(0, 2);
        const alarms = reminderMinutes.map((minutes) => ({ relativeOffset: -Math.abs(minutes) }));
        const notes = (item.memo || '').trim() + fullTextSuffix;
        tasks.push(() =>
          Calendar.createEventAsync(deviceCalId, {
            title: item.eventName.trim() || '（無題）',
            startDate,
            endDate,
            notes: notes || undefined,
            alarms,
            ...(item.isAllDay ? { allDay: true } : {}),
          }).then(() => {})
        );
      }
    }

    if (selectedLinkedEmails.length > 0) {
      let selectedValid: ValidLinkedAccount[];
      try {
        const valid = await getValidLinkedAccounts();
        selectedValid = valid.filter((a) => selectedLinkedEmails.includes(a.email));
      } catch {
        Alert.alert('エラー', 'アカウント情報の取得に失敗しました。');
        return;
      }
      if (selectedValid.length === 0) {
        Alert.alert('確認', '選択したアカウントのトークンが無効です。再度ログインするか、別のアカウントを選択してください。');
        return;
      }
      const pad2 = (n: number) => String(n).padStart(2, '0');
      for (const item of selectedItems) {
        const startDate = safeParseDate(item.eventDate)!;
        let endDate = safeParseDate(item.endDate)!;
        if (item.isAllDay) {
          endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 1);
          endDate.setHours(0, 0, 0, 0);
        }
        const summary = item.eventName.trim() || '（無題）';
        const description = (item.memo || '').trim() + fullTextSuffix || undefined;
        const effectiveColorHex = isGlobalSettingsEnabled ? calendarColor : item.customColor;
        const effectiveMain = isGlobalSettingsEnabled ? mainReminder : item.customMainReminder;
        const effectiveBackup = isGlobalSettingsEnabled ? backupReminder : item.customBackupReminder;
        const colorId = GOOGLE_CALENDAR_COLORS.find((c) => c.hex === effectiveColorHex)?.id;
        const reminderMinutes = [effectiveMain, effectiveBackup]
          .filter((x): x is number => x !== 'none')
          .slice(0, 2);
        const reminders = {
          useDefault: false,
          overrides: reminderMinutes.map((minutes) => ({ method: 'popup' as const, minutes: Math.abs(minutes) })),
        };
        const endDateOnly =
          `${endDate.getFullYear()}-${pad2(endDate.getMonth() + 1)}-${pad2(endDate.getDate())}`;
        const payload: CreateEventPayload = item.isAllDay
          ? {
              summary,
              description,
              start: { date: item.eventDate.slice(0, 10) },
              end: { date: endDateOnly },
              ...(colorId ? { colorId } : {}),
              reminders,
            }
          : {
              summary,
              description,
              start: { dateTime: item.eventDate, timeZone: tz },
              end: { dateTime: dateToLocalISO(endDate), timeZone: tz },
              ...(colorId ? { colorId } : {}),
              reminders,
            };
        for (const { accessToken } of selectedValid) {
          tasks.push(() => createCalendarEvent(accessToken, 'primary', payload).then(() => undefined));
        }
      }
    }

    try {
      await Promise.all(tasks.map((t) => t()));
    } catch (e) {
      console.warn('[Calendar] registration error', e);
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('401') || msg.includes('invalid') || msg.includes('token')) {
        Alert.alert('ログインの有効期限', '該当アカウントの連携を解除し、再度「Googleで連携する」からログインしてください。');
        getLinkedAccounts().then(setLinkedAccounts).catch(() => {});
      } else {
        Alert.alert('エラー', msg || 'カレンダーへの登録に失敗しました。');
      }
      return;
    }

    const parts: string[] = [];
    if (useDeviceCalendar) parts.push('端末');
    if (selectedLinkedEmails.length > 0) parts.push(`Google${selectedLinkedEmails.length > 1 ? `（${selectedLinkedEmails.length}件）` : ''}`);
    Alert.alert('成功', `${parts.join('・')}に${selectedItems.length}件の予定を登録しました！`);
    if (notifyOnCalendarComplete) {
      notifyCalendarRegistrationComplete(selectedItems.length).catch(() => {});
    }
    cleanupCalendarStateAfterRegistration();
  }, [editedEvents, result, calendarColor, mainReminder, backupReminder, isGlobalSettingsEnabled, useDeviceCalendar, linkedAccounts, selectedLinkedEmails, notifyOnCalendarComplete, cleanupCalendarStateAfterRegistration, getDeviceCalendarId]);

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
            imageUriOut = await cropImageByRegion(imageUri, w, h, prob.imageRegion);
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
      Alert.alert('エラー', 'フラッシュカードの保存に失敗しました。しばらく経ってから再度お試しください。');
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
        return `<div style="position:relative;width:100%;height:100vh;box-sizing:border-box;${pageBreak}"><img src="${imgSrc}" style="display:block;max-height:100vh;max-width:100vw;width:100%;height:auto;object-fit:contain;margin:0 auto;vertical-align:bottom;" /><div style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;">${overlayDivs}</div></div>`;
      });
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{margin:0;}*{margin:0;padding:0;box-sizing:border-box;}html,body{margin:0;padding:0;height:100vh;overflow:hidden;}img{display:block;max-height:100vh;max-width:100vw;object-fit:contain;margin:0 auto;vertical-align:bottom;}</style></head><body>${pageHtmls.join('')}</body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      await Share.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: '復習用PDFを保存' });
      void recordSuccessAndMaybeRequestReview();
    } catch (e) {
      console.warn('[PDF] generation error', e);
      Alert.alert('エラー', 'PDFの生成に失敗しました。しばらく経ってから再度お試しください。');
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
      void recordSuccessAndMaybeRequestReview();
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
    if (isPremium) return null;
    if (!adsReady) return null;
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
            key={`banner-${bannerReloadToken}`}
            unitId={unitId}
            size={size}
            requestOptions={{ requestNonPersonalizedAdsOnly: false }}
            onAdLoaded={() => {
              if (bannerRetryTimerRef.current) {
                clearTimeout(bannerRetryTimerRef.current);
                bannerRetryTimerRef.current = null;
              }
            }}
            onAdFailedToLoad={(error: unknown) => {
              console.error('[Ads] Banner failed to load - retrying', error);
              if (bannerRetryTimerRef.current) {
                clearTimeout(bannerRetryTimerRef.current);
              }
              bannerRetryTimerRef.current = setTimeout(() => {
                setBannerReloadToken((prev) => prev + 1);
              }, 4500);
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
              カメラで撮影、アルバムから画像を選ぶ、またはテキストを貼り付けて解析します。
            </ThemedText>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={pickFromCamera} activeOpacity={0.8}>
              <ThemedText style={styles.primaryButtonText}>カメラで撮る</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={pickFromAlbum} activeOpacity={0.8}>
              <ThemedText style={styles.primaryButtonText}>アルバムから選ぶ</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={() => setShowPasteTextModal(true)} activeOpacity={0.8}>
              <ThemedText style={styles.primaryButtonText}>テキストを貼り付け</ThemedText>
            </TouchableOpacity>
          </View>

          <Modal visible={showPasteTextModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <View style={styles.pasteModalContent}>
                <ThemedText style={styles.pasteModalTitle}>テキストを貼り付けて解析</ThemedText>
                <TextInput
                  style={styles.pasteTextInput}
                  placeholder="プリントの内容をコピーしてここに貼り付けてください"
                  placeholderTextColor="#999"
                  multiline
                  numberOfLines={6}
                  value={pastedText}
                  onChangeText={setPastedText}
                  editable={!analyzingText}
                />
                <View style={styles.pasteModalButtons}>
                  <TouchableOpacity
                    style={styles.pasteModalButtonCancel}
                    onPress={() => { setShowPasteTextModal(false); setPastedText(''); setErrorMessage(null); }}
                    disabled={analyzingText}
                  >
                    <ThemedText style={styles.pasteModalButtonCancelText}>キャンセル</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pasteModalButtonSubmit, analyzingText && styles.pasteModalButtonDisabled]}
                    onPress={async () => {
                      if (!pastedText.trim()) {
                        setErrorMessage('テキストを入力してください。');
                        return;
                      }
                      setAnalyzingText(true);
                      setErrorMessage(null);
                      try {
                        const analyzed = await analyzePrintFromText(pastedText);
                        setResult(analyzed);
                        setShowPasteTextModal(false);
                        setPastedText('');
                        void recordSuccessAndMaybeRequestReview();
                      } catch (e) {
                        setErrorMessage(e instanceof Error ? e.message : '解析に失敗しました。');
                      } finally {
                        setAnalyzingText(false);
                      }
                    }}
                    disabled={analyzingText}
                  >
                    {analyzingText ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <ThemedText style={styles.pasteModalButtonSubmitText}>解析する</ThemedText>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          <Modal visible={showGoogleConsentModal} transparent animationType="fade">
            <View style={styles.consentModalOverlay}>
              <View style={styles.consentModalContent}>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <ThemedText
                    style={styles.consentModalTitle}
                    lightColor={Pastel.coralStrong}
                    darkColor={Pastel.coralStrong}
                  >
                    【Googleカレンダー連携の手順】
                  </ThemedText>
                  <ThemedText
                    style={styles.consentModalBody}
                    lightColor="#333333"
                    darkColor="#333333"
                  >
                    連携時にGoogleの確認画面が表示される場合があります。その際は以下の手順で進めてください。
                  </ThemedText>
                  <ThemedText style={styles.consentModalStep} lightColor="#333333" darkColor="#333333">
                    ① アカウントを選択する
                  </ThemedText>
                  <ThemedText style={styles.consentModalStep} lightColor="#333333" darkColor="#333333">
                    ②「Google ではこのアプリを確認していません」という画面が出た場合、左下の「詳細」をタップする
                  </ThemedText>
                  <ThemedText style={styles.consentModalStep} lightColor="#333333" darkColor="#333333">
                    ③「パシャっと管理（安全ではないページ）に移動」をタップする
                  </ThemedText>
                  <ThemedText style={styles.consentModalStep} lightColor="#333333" darkColor="#333333">
                    ④（ログイン画面が出た場合は次へ進む）
                  </ThemedText>
                  <ThemedText style={styles.consentModalStep} lightColor="#333333" darkColor="#333333">
                    ⑤ パシャっと管理がアクセスを求めています、の画面で【チェックボックスをすべて選択】して「続行」をタップする
                  </ThemedText>
                </ScrollView>
                <TouchableOpacity
                  style={styles.consentModalButton}
                  onPress={() => {
                    setShowGoogleConsentModal(false);
                    runGoogleLinkFlow();
                  }}
                  activeOpacity={0.8}
                >
                  <ThemedText
                    style={styles.consentModalButtonText}
                    lightColor="#ffffff"
                    darkColor="#ffffff"
                  >
                    了解して連携する
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.consentModalCancel}
                  onPress={() => setShowGoogleConsentModal(false)}
                >
                  <ThemedText
                    style={styles.consentModalCancelText}
                    lightColor="#444444"
                    darkColor="#444444"
                  >
                    キャンセル
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {errorMessage ? (
            <View style={styles.errorBox}>
              <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
            </View>
          ) : null}

          {imageUri ? (
            <>
              <View style={[styles.previewContainer, result?.type === 'テスト' && imageWidth > 0 && imageHeight > 0 && { aspectRatio: imageWidth / imageHeight }]}>
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
                      解析中…広告が流れている間しばらくお待ちください
                    </ThemedText>
                  </View>
                ) : (
                  <ThemedText style={styles.analyzeButtonText}>
                    解析する（解析中は広告が流れます）
                  </ThemedText>
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
                ※AIが複数枚のプリントを全力で解析するため、数十秒かかります。解析中は広告が表示され、閉じると結果画面へ進みます。
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
              <ThemedText style={styles.aiNoteText}>
                ※AIの解析結果は毎回少しずつ変わることがあります。もし結果に違和感がある場合は、お手数ですがもう一度「解析する（解析中は広告が流れます）」をお試しください。
              </ThemedText>

              {result.type === 'お知らせ' ? (
                <View style={styles.oshiraseBox}>
                  <ThemedText style={styles.resultLabel}>
                    予定一覧（編集可・チェックした予定だけカレンダーに追加されます）
                  </ThemedText>
                  <ThemedText style={styles.dateHint}>
                    タップして日時を修正できます。開始日時・終了日時をタップすると変更できます。
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
                      <ThemedText style={styles.fieldLabel}>開始日時</ThemedText>
                      <TouchableOpacity
                        style={styles.datePickerButton}
                        onPress={() => openDateTimePicker(index, 'eventDate')}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.datePickerButtonText}>
                          {item.isAllDay && safeParseDate(item.eventDate)
                            ? `${new Date(item.eventDate).getFullYear()}年${new Date(item.eventDate).getMonth() + 1}月${new Date(item.eventDate).getDate()}日 終日`
                            : safeParseDate(item.eventDate)
                            ? `${new Date(item.eventDate).getFullYear()}年${new Date(item.eventDate).getMonth() + 1}月${new Date(item.eventDate).getDate()}日 ${String(new Date(item.eventDate).getHours()).padStart(2, '0')}:${String(new Date(item.eventDate).getMinutes()).padStart(2, '0')}`
                            : '日時を選択'}
                        </Text>
                        <Text style={styles.datePickerIcon}>📅</Text>
                      </TouchableOpacity>
                      <ThemedText style={styles.fieldLabel}>終了日時</ThemedText>
                      <TouchableOpacity
                        style={[styles.datePickerButton, item.isAllDay && styles.datePickerButtonDisabled]}
                        onPress={() => !item.isAllDay && openDateTimePicker(index, 'endDate')}
                        activeOpacity={0.7}
                        disabled={item.isAllDay}
                      >
                        <Text style={styles.datePickerButtonText}>
                          {item.isAllDay && safeParseDate(item.endDate)
                            ? '終日（終了は同じ日）'
                            : safeParseDate(item.endDate)
                            ? `${new Date(item.endDate).getFullYear()}年${new Date(item.endDate).getMonth() + 1}月${new Date(item.endDate).getDate()}日 ${String(new Date(item.endDate).getHours()).padStart(2, '0')}:${String(new Date(item.endDate).getMinutes()).padStart(2, '0')}`
                            : '日時を選択'}
                        </Text>
                        <Text style={styles.datePickerIcon}>📅</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.allDayRow}
                        onPress={() => updateEditedEvent(index, 'isAllDay', !item.isAllDay)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkbox, item.isAllDay && styles.checkboxChecked]}>
                          {item.isAllDay ? <ThemedText style={styles.checkboxMark}>✓</ThemedText> : null}
                        </View>
                        <ThemedText style={styles.checkboxLabel}>終日にする</ThemedText>
                      </TouchableOpacity>
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

                      <TouchableOpacity
                        style={styles.customToggle}
                        onPress={() => updateEditedEvent(index, 'useCustomSettings', !item.useCustomSettings)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.customToggleText}>
                          {item.useCustomSettings ? '▼ 個別設定を閉じる' : '▶ この予定だけ色・通知を変える'}
                        </Text>
                      </TouchableOpacity>
                      {item.useCustomSettings && (
                        <View style={styles.customSettingsBox}>
                          <ThemedText style={styles.fieldLabel}>この予定の色</ThemedText>
                          <View style={styles.colorRow}>
                            {GOOGLE_CALENDAR_COLORS.map((c) => (
                              <TouchableOpacity
                                key={c.id}
                                style={[
                                  styles.colorCircleSm,
                                  { backgroundColor: c.hex },
                                  item.customColor === c.hex && styles.colorCircleSelected,
                                ]}
                                onPress={() => updateEditedEvent(index, 'customColor', c.hex)}
                                activeOpacity={0.7}
                              >
                                {item.customColor === c.hex && <Text style={styles.colorCheckMarkSm}>✓</Text>}
                              </TouchableOpacity>
                            ))}
                          </View>
                          <ThemedText style={styles.fieldLabel}>この予定の通知</ThemedText>
                          {renderReminderRow(
                            item.customMainReminder,
                            (v) => updateEditedEvent(index, 'customMainReminder', v)
                          )}
                          <ThemedText style={styles.fieldLabel}>予備の通知</ThemedText>
                          {renderReminderRow(
                            item.customBackupReminder,
                            (v) => updateEditedEvent(index, 'customBackupReminder', v)
                          )}
                        </View>
                      )}
                    </View>
                  ))}

                  <ThemedText style={styles.fieldLabel}>登録先</ThemedText>
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setUseDeviceCalendar((v) => !v)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.checkbox, useDeviceCalendar && styles.checkboxChecked]}>
                      {useDeviceCalendar ? <ThemedText style={styles.checkboxMark}>✓</ThemedText> : null}
                    </View>
                    <ThemedText
                      style={styles.checkboxLabel}
                      lightColor="#333333"
                      darkColor="#333333"
                    >
                      📱 端末の標準カレンダー
                    </ThemedText>
                  </TouchableOpacity>
                  {useDeviceCalendar && Platform.OS === 'ios' && (
                    <ThemedText
                      style={styles.colorHint}
                      lightColor="#4a4a4a"
                      darkColor="#4a4a4a"
                    >
                      ※iPhone標準カレンダーでは個別の色設定は反映されません。
                    </ThemedText>
                  )}

                  <ThemedText
                    style={[styles.fieldLabel, { marginTop: 14 }]}
                    lightColor={Pastel.coralStrong}
                    darkColor={Pastel.coralStrong}
                  >
                    ☁️ Googleカレンダー（API連携）
                  </ThemedText>
                  <ThemedText
                    style={styles.colorHint}
                    lightColor="#4a4a4a"
                    darkColor="#4a4a4a"
                  >
                    ※iPhoneの標準カレンダー（または端末内のカレンダー）のみをご利用の方は、このGoogle連携設定は不要です。そのままお使いいただけます。
                  </ThemedText>
                  {linkedAccounts.length === 0 ? (
                    <TouchableOpacity
                      style={styles.loadAccountsButton}
                      onPress={() => setShowGoogleConsentModal(true)}
                      disabled={!googleSignInReady || loadingGoogleAuth}
                      activeOpacity={0.8}
                    >
                      {loadingGoogleAuth ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <ThemedText
                          style={styles.loadAccountsButtonText}
                          lightColor="#ffffff"
                          darkColor="#ffffff"
                        >
                          Googleで連携する
                        </ThemedText>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <>
                      <View style={styles.accountList}>
                        {linkedAccounts.map((acc) => {
                          const checked = selectedLinkedEmails.includes(acc.email);
                          return (
                            <View key={acc.email} style={styles.accountRowWithUnlink}>
                              <TouchableOpacity
                                style={styles.accountRow}
                                onPress={() => {
                                  setSelectedLinkedEmails((prev) =>
                                    checked ? prev.filter((e) => e !== acc.email) : [...prev, acc.email]
                                  );
                                }}
                                activeOpacity={0.7}
                              >
                                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                                  {checked ? <ThemedText style={styles.checkboxMark}>✓</ThemedText> : null}
                                </View>
                                <ThemedText
                                  style={styles.checkboxLabel}
                                  numberOfLines={1}
                                  lightColor="#333333"
                                  darkColor="#333333"
                                >
                                  {acc.email}
                                </ThemedText>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.unlinkButton}
                                onPress={() => {
                                  Alert.alert(
                                    '連携解除',
                                    `${acc.email} の連携を解除しますか？`,
                                    [
                                      { text: 'キャンセル' },
                                      {
                                        text: '解除',
                                        style: 'destructive',
                                        onPress: () => {
                                          removeLinkedAccount(acc.email).then(() =>
                                            getLinkedAccounts().then(setLinkedAccounts)
                                          );
                                          setSelectedLinkedEmails((prev) => prev.filter((e) => e !== acc.email));
                                        },
                                      },
                                    ]
                                  );
                                }}
                              >
                                <ThemedText
                                  style={styles.unlinkButtonText}
                                  lightColor="#c62828"
                                  darkColor="#c62828"
                                >
                                  解除
                                </ThemedText>
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                      <TouchableOpacity
                        style={styles.addAccountButton}
                        onPress={() => {
                          setTimeout(() => runGoogleLinkFlow(), 100);
                        }}
                        disabled={!googleSignInReady || loadingGoogleAuth}
                        activeOpacity={0.8}
                      >
                        <ThemedText
                          style={styles.loadAccountsButtonText}
                          lightColor="#ffffff"
                          darkColor="#ffffff"
                        >
                          ＋ 別のGoogleアカウントを追加連携する
                        </ThemedText>
                      </TouchableOpacity>
                    </>
                  )}

                  <ThemedText style={styles.fieldLabel}>一括設定（色・通知）</ThemedText>
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setIsGlobalSettingsEnabled((v) => !v)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.checkbox, isGlobalSettingsEnabled && styles.checkboxChecked]}>
                      {isGlobalSettingsEnabled ? <ThemedText style={styles.checkboxMark}>✓</ThemedText> : null}
                    </View>
                    <ThemedText style={styles.checkboxLabel}>すべての予定に一括設定を適用する</ThemedText>
                  </TouchableOpacity>
                  {!isGlobalSettingsEnabled && (
                    <ThemedText
                      style={styles.colorHint}
                      lightColor="#4a4a4a"
                      darkColor="#4a4a4a"
                    >
                      OFFのときは各予定の「この予定だけ色・通知を変える」の個別設定が使われます。
                    </ThemedText>
                  )}

                  <ThemedText style={styles.fieldLabel}>予定の色（カレンダーに反映されます）</ThemedText>
                  <View style={styles.colorSelectedRow}>
                    <View style={[styles.colorSelectedCircle, { backgroundColor: calendarColor }]} />
                    <Text style={styles.colorSelectedName}>
                      選択中：{GOOGLE_CALENDAR_COLORS.find((c) => c.hex === calendarColor)?.label ?? ''}
                    </Text>
                  </View>
                  <View style={styles.colorRow}>
                    {GOOGLE_CALENDAR_COLORS.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[
                          styles.colorCircle,
                          { backgroundColor: c.hex },
                          calendarColor === c.hex && styles.colorCircleSelected,
                        ]}
                        onPress={() => setCalendarColor(c.hex)}
                        activeOpacity={0.7}
                      >
                        {calendarColor === c.hex && <Text style={styles.colorCheckMark}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>

                  {String(Platform.OS) === 'android' && (
                    <>
                      <ThemedText
                        style={styles.colorHint}
                        lightColor="#4a4a4a"
                        darkColor="#4a4a4a"
                      >
                        ※Googleカレンダー・ウェブへの反映に数分かかることがあります。
                      </ThemedText>
                      <TouchableOpacity
                        style={styles.notifyCheckRow}
                        onPress={() => setNotifyOnCalendarComplete((v) => !v)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkbox, notifyOnCalendarComplete && styles.checkboxChecked]}>
                          {notifyOnCalendarComplete ? <ThemedText style={styles.checkboxMark}>✓</ThemedText> : null}
                        </View>
                        <ThemedText style={styles.checkboxLabel}>登録完了後に通知で知らせる</ThemedText>
                      </TouchableOpacity>
                    </>
                  )}

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
                      Googleカレンダー（API連携）に対応{'\n'}
                      Googleカレンダーは12色から色を選んで登録可能{'\n'}
                      日時の修正もかんたん（プルダウン式ピッカー）
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
      <DateTimePickerModal
        visible={dtPickerVisible}
        value={(() => {
          const item = editedEvents[dtPickerTarget.index];
          if (!item) return new Date();
          const d = safeParseDate(item[dtPickerTarget.field === 'eventDate' ? 'eventDate' : 'endDate']);
          return d ?? new Date();
        })()}
        onConfirm={handleDateTimePicked}
        onCancel={() => setDtPickerVisible(false)}
        title={dtPickerTarget.field === 'eventDate' ? '開始日時を選択' : '終了日時を選択'}
      />
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
  aiNoteText: {
    fontSize: 11,
    color: '#777',
    marginBottom: 8,
    lineHeight: 16,
  },
  resultLabel: {
    fontSize: 12,
    opacity: 0.85,
    marginTop: 8,
    marginBottom: 2,
    color: Pastel.coralStrong,
  },
  dateHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    marginBottom: 8,
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
  checkboxLabelMuted: {
    fontSize: 14,
    color: '#999',
  },
  checkboxDisabled: {
    opacity: 0.5,
  },
  linkButton: {
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 8,
  },
  linkButtonText: {
    fontSize: 14,
    color: Pastel.coralStrong,
    textDecorationLine: 'underline',
  },
  allDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 4,
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
  calTargetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
  },
  calTargetButton: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Pastel.coralStrong,
  },
  calTargetButtonActive: {
    backgroundColor: Pastel.coralStrong,
  },
  calTargetText: {
    fontSize: 12,
    color: Pastel.coralStrong,
    fontWeight: '600',
  },
  calTargetTextActive: {
    color: '#fff',
  },
  customToggle: {
    marginTop: 10,
    paddingVertical: 8,
  },
  customToggleText: {
    fontSize: 12,
    color: Pastel.coralStrong,
    fontWeight: '600',
  },
  customSettingsBox: {
    marginTop: 4,
    paddingTop: 8,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: Pastel.coral,
  },
  colorCircleSm: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorCheckMarkSm: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  colorSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(201,123,99,0.08)',
    borderRadius: 12,
  },
  colorSelectedCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  colorSelectedName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  colorCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorCircleSelected: {
    borderColor: '#333',
    borderWidth: 3,
  },
  colorCheckMark: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  colorHint: {
    fontSize: 11,
    color: '#888',
    marginBottom: 12,
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Pastel.coral,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  datePickerButtonText: {
    fontSize: 15,
    color: '#333',
  },
  datePickerIcon: {
    fontSize: 18,
  },
  datePickerButtonDisabled: {
    opacity: 0.7,
  },
  loadAccountsButton: {
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Pastel.borderRadius,
    alignItems: 'center',
    marginBottom: 12,
  },
  loadAccountsButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  accountList: {
    marginBottom: 12,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  linkedAccountBlock: {
    marginBottom: 14,
    paddingLeft: 4,
  },
  accountRowWithUnlink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  unlinkButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  unlinkButtonText: {
    fontSize: 13,
    color: '#c00',
    textDecorationLine: 'underline',
  },
  addAccountButton: {
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: Pastel.borderRadius,
    backgroundColor: Pastel.coral,
    alignItems: 'center',
  },
  loadCalendarsLink: {
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 6,
  },
  calendarSubList: {
    marginLeft: 20,
    marginTop: 4,
  },
  notifyCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pasteModalContent: {
    backgroundColor: '#fff',
    borderRadius: Pastel.borderRadius,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  consentModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  consentModalContent: {
    backgroundColor: '#fff',
    borderRadius: Pastel.borderRadius,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
  },
  consentModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    color: '#333333',
  },
  consentModalBody: {
    fontSize: 14,
    marginBottom: 14,
    lineHeight: 22,
    color: '#333333',
  },
  consentModalStep: {
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 20,
    paddingLeft: 4,
    color: '#333333',
  },
  consentModalButton: {
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 12,
    borderRadius: Pastel.borderRadius,
    alignItems: 'center',
    marginTop: 16,
  },
  consentModalButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  consentModalCancel: {
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 8,
  },
  consentModalCancelText: {
    fontSize: 14,
    color: '#444444',
  },
  pasteModalTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: Pastel.coralStrong,
  },
  pasteTextInput: {
    borderWidth: 1,
    borderColor: Pastel.coral,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  pasteModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  pasteModalButtonCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  pasteModalButtonCancelText: {
    fontSize: 15,
    color: '#666',
  },
  pasteModalButtonSubmit: {
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: Pastel.borderRadius,
  },
  pasteModalButtonSubmitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  pasteModalButtonDisabled: {
    opacity: 0.6,
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
