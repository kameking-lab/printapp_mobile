/**
 * バナー・インタースティシャル広告（本番ID・クラッシュしないエラーハンドリング）
 */

import { Platform } from 'react-native';

// 本番用広告枠ID
const BANNER_UNIT_ID = Platform.select({
  android: 'ca-app-pub-8751260838396451/5852361668',
  ios: 'ca-app-pub-8751260838396451/3226198327',
  default: 'ca-app-pub-8751260838396451/5852361668',
});

const INTERSTITIAL_UNIT_ID = Platform.select({
  android: 'ca-app-pub-8751260838396451/2076079822',
  ios: 'ca-app-pub-8751260838396451/4940577584',
  default: 'ca-app-pub-8751260838396451/2076079822',
});

export { BANNER_UNIT_ID, INTERSTITIAL_UNIT_ID };

let mobileAdsInitialized = false;

/** 広告SDKを初期化（アプリ起動時に1回。失敗しても続行） */
export async function initMobileAds(): Promise<void> {
  if (mobileAdsInitialized) return;
  try {
    const mobileAds = (await import('react-native-google-mobile-ads')).default;
    await mobileAds().initialize();
    mobileAdsInitialized = true;
  } catch {
    // 広告未利用環境・ネットワークエラーでもクラッシュさせない
  }
}

/** インタースティシャルをロードして表示。表示後に onDone を呼ぶ。失敗・スキップ時も onDone を必ず呼ぶ */
export async function showInterstitialThen(onDone: () => void): Promise<void> {
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
    const ad = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID ?? '');
    const timeout = setTimeout(done, 8000);

    ad.addAdEventListener(AdEventType.LOADED, () => {
      clearTimeout(timeout);
      ad.show().catch(done);
    });
    ad.addAdEventListener(AdEventType.CLOSED, () => {
      clearTimeout(timeout);
      done();
    });
    ad.addAdEventListener(AdEventType.ERROR, done);

    await ad.load().catch(done);
  } catch {
    onDone();
  }
}
