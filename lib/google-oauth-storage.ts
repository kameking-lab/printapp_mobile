/**
 * Google OAuth 複数アカウントの端末内永続化（キー: メールアドレス）
 * 各アカウントごとに accessToken / refreshToken を保持し、期限切れ時はリフレッシュする。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TokenResponse, refreshAsync } from 'expo-auth-session';
import { discovery } from 'expo-auth-session/providers/google';

const STORAGE_KEY = '@printapp/google_oauth_accounts';

export type StoredAccount = {
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  issuedAt?: number;
};

/** 連携済みアカウント配列を保存 */
export async function saveLinkedAccounts(accounts: StoredAccount[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

/** 連携済みアカウント一覧を取得（未保存なら []） */
export async function getLinkedAccounts(): Promise<StoredAccount[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as StoredAccount[];
    return Array.isArray(data) ? data.filter((a) => a?.email && a?.accessToken) : [];
  } catch {
    return [];
  }
}

/**
 * 1アカウントを追加（配列に push）、または同一 email が既にいればその要素だけ更新。
 * email を一意キーとして配列を管理する。
 */
export async function addOrUpdateLinkedAccount(account: StoredAccount): Promise<void> {
  const list = await getLinkedAccounts();
  const key = account.email.trim().toLowerCase();
  const rest = list.filter((a) => (a.email ?? '').trim().toLowerCase() !== key);
  await saveLinkedAccounts([...rest, account]);
}

/** 1アカウント削除（連携解除） */
export async function removeLinkedAccount(email: string): Promise<void> {
  const list = await getLinkedAccounts();
  const next = list.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
  await saveLinkedAccounts(next);
}

export type ValidLinkedAccount = { email: string; accessToken: string };

/**
 * 有効なアクセストークンを持つ連携済みアカウント一覧を返す。
 * 期限切れはリフレッシュして保存。リフレッシュ失敗時もストレージからは削除せず残す（リストは縮めない）。
 */
export async function getValidLinkedAccounts(
  clientId: string,
  scopes: string[]
): Promise<ValidLinkedAccount[]> {
  const list = await getLinkedAccounts();
  const result: ValidLinkedAccount[] = [];
  const updated: StoredAccount[] = [];

  for (const acc of list) {
    const tokenInfo = {
      accessToken: acc.accessToken,
      refreshToken: acc.refreshToken,
      expiresIn: acc.expiresIn,
      issuedAt: acc.issuedAt ?? Math.floor(Date.now() / 1000),
    };
    const isFresh = TokenResponse.isTokenFresh(tokenInfo);
    if (isFresh) {
      result.push({ email: acc.email, accessToken: acc.accessToken });
      updated.push(acc);
      continue;
    }
    if (!acc.refreshToken) {
      updated.push(acc);
      continue;
    }
    try {
      const refreshed = await refreshAsync(
        { clientId, refreshToken: acc.refreshToken, scopes },
        discovery
      );
      const config = refreshed.getRequestConfig();
      const newAcc: StoredAccount = {
        email: acc.email,
        accessToken: config.accessToken,
        refreshToken: config.refreshToken ?? acc.refreshToken,
        expiresIn: config.expiresIn,
        issuedAt: config.issuedAt,
      };
      result.push({ email: acc.email, accessToken: newAcc.accessToken });
      updated.push(newAcc);
    } catch {
      updated.push(acc);
    }
  }

  if (updated.some((u, i) => u.accessToken !== list[i]?.accessToken)) {
    await saveLinkedAccounts(updated);
  }
  return result;
}
