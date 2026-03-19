/**
 * RevenueCat 月額プレミアム（広告非表示）の Context
 * Expo Go ではネイティブモジュールが存在しないため configure をスキップしクラッシュを防ぐ。
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { isExpoGo } from './env';

const REVENUECAT_API_KEY_IOS = 'appl_oAcevySxzYDoggsbUklkkiqgMln';
const REVENUECAT_API_KEY_ANDROID = 'goog_uFqDhlkdQyDLjCeMrvmyywnyOcG';

interface PremiumContextValue {
  isPremium: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const PremiumContext = createContext<PremiumContextValue>({
  isPremium: false,
  isLoading: true,
  refresh: async () => {},
});

export function usePremium(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) {
    return { isPremium: false, isLoading: false, refresh: async () => {} };
  }
  return ctx;
}

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (isExpoGo()) {
      setIsPremium(false);
      setIsLoading(false);
      return;
    }
    try {
      const Purchases = (await import('react-native-purchases')).default;
      const info = await Purchases.getCustomerInfo();
      const active = info.entitlements?.active?.['premium'];
      setIsPremium(!!active);
    } catch {
      setIsPremium(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isExpoGo()) {
        setIsPremium(false);
        setIsLoading(false);
        return;
      }
      try {
        const Purchases = (await import('react-native-purchases')).default;
        const apiKey = Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
        Purchases.configure({ apiKey });
        if (cancelled) return;
        const info = await Purchases.getCustomerInfo();
        const active = info.entitlements?.active?.['premium'];
        setIsPremium(!!active);
      } catch (e) {
        console.warn('[Premium] RevenueCat init/customerInfo failed (may be Expo Go)', e);
        setIsPremium(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PremiumContext.Provider value={{ isPremium, isLoading, refresh }}>
      {children}
    </PremiumContext.Provider>
  );
}
