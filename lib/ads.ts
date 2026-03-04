/**
 * バナー・インタースティシャル広告（本番ID・__DEV__時はテストID・プレミアム時は非表示）
 * Expo Go ではネイティブモジュールが存在しないため初期化・表示をスキップする。
 */

import { Platform } from 'react-native';

import { isExpoGo } from './env';

const TEST_BANNER = Platform.select({
  android: 'ca-app-pub-3940256099942544/6300978111',
  ios: 'ca-app-pub-3940256099942544/2934735716',
  default: 'ca-app-pub-3940256099942544/6300978111',
});
const TEST_INTERSTITIAL = Platform.select({
  android: 'ca-app-pub-3940256099942544/1033173712',
  ios: 'ca-app-pub-3940256099942544/4411468910',
  default: 'ca-app-pub-3940256099942544/1033173712',
});
const PROD_BANNER = Platform.select({
  android: 'ca-app-pub-8751260838396451/5852361668',
  ios: 'ca-app-pub-8751260838396451/3226198327',
  default: 'ca-app-pub-8751260838396451/5852361668',
});
const PROD_INTERSTITIAL = Platform.select({
  android: 'ca-app-pub-8751260838396451/2076079822',
  ios: 'ca-app-pub-8751260838396451/4940577584',
  default: 'ca-app-pub-8751260838396451/2076079822',
});

const BANNER_UNIT_ID = typeof __DEV__ !== 'undefined' && __DEV__ ? TEST_BANNER : PROD_BANNER;
const INTERSTITIAL_UNIT_ID = typeof __DEV__ !== 'undefined' && __DEV__ ? TEST_INTERSTITIAL : PROD_INTERSTITIAL;

export { BANNER_UNIT_ID, INTERSTITIAL_UNIT_ID };

let mobileAdsInitialized = false;

export async function requestTrackingPermission(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } = await import(
      'expo-tracking-transparency'
    );
    const { status } = await getTrackingPermissionsAsync();
    if (status === 'undetermined') {
      await requestTrackingPermissionsAsync();
    }
  } catch (e) {
    console.error('[Ads] ATT request failed', e);
  }
}

/** 広告SDKを初期化。Expo Go・プレミアムの場合は何もしない。ネイティブモジュール不在時はクラッシュせずスキップ */
export async function initMobileAds(isPremium: boolean): Promise<void> {
  if (isPremium) return;
  if (mobileAdsInitialized) return;
  if (isExpoGo()) {
    console.log('[Ads] Skipping init in Expo Go (no native module)');
    return;
  }
  try {
    await requestTrackingPermission();
    const mobileAds = (await import('react-native-google-mobile-ads')).default;
    await mobileAds().initialize();
    mobileAdsInitialized = true;
    console.log('[Ads] Mobile Ads SDK initialized');
  } catch (e) {
    console.warn('[Ads] Failed to initialize Mobile Ads SDK (may be Expo Go)', e);
  }
}

/** インタースティシャル表示。Expo Go・プレミアムの場合は即 onDone を呼ぶ */
export async function showInterstitialThen(onDone: () => void, isPremium: boolean): Promise<void> {
  if (isPremium) {
    onDone();
    return;
  }
  if (isExpoGo()) {
    onDone();
    return;
  }
  let resolved = false;
  const done = () => {
    if (resolved) return;
    resolved = true;
    onDone();
  };
  try {
    const ads = await import('react-native-google-mobile-ads');
    const InterstitialAd = ads.InterstitialAd;
    const AdEventType = ads.AdEventType;
    const adUnitId = INTERSTITIAL_UNIT_ID ?? '';
    const ad = InterstitialAd.createForAdRequest(adUnitId);
    const timeout = setTimeout(done, 8000);
    ad.addAdEventListener(AdEventType.LOADED, () => {
      clearTimeout(timeout);
      ad.show().catch(done);
    });
    ad.addAdEventListener(AdEventType.CLOSED, () => {
      clearTimeout(timeout);
      done();
    });
    ad.addAdEventListener(AdEventType.ERROR, () => {
      clearTimeout(timeout);
      done();
    });
    try {
      await ad.load();
    } catch {
      done();
    }
  } catch (e) {
    console.warn('[Ads] Interstitial load failed (may be Expo Go)', e);
    onDone();
  }
}

/** Expo Go かどうか（バナー等のフォールバック表示に利用） */
export { isExpoGo } from './env';
