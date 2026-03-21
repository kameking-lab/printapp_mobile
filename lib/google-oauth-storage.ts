/**
 * Google OAuth 複数アカウントの端末内永続化（キー: メールアドレス）
 * 各アカウントごとに accessToken を保持。期限切れは @react-native-google-signin の
 * 現在セッションと照合し、一致すれば getTokens() で更新する。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

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
 * 保存トークンが期限内ならそのまま。切れている場合は GoogleSignin の現在ユーザーと
 * メールが一致するときのみ getTokens() で更新して保存する。
 */
export async function getValidLinkedAccounts(): Promise<ValidLinkedAccount[]> {
  const list = await getLinkedAccounts();
  const now = Math.floor(Date.now() / 1000);
  const result: ValidLinkedAccount[] = [];
  const updated = list.map((a) => ({ ...a }));
  let needsSave = false;

  let sdkEmail: string | null = null;
  let sdkAccessToken: string | null = null;
  try {
    const current = GoogleSignin.getCurrentUser();
    const email = current?.user.email?.trim().toLowerCase();
    if (email) {
      const tokens = await GoogleSignin.getTokens();
      sdkEmail = email;
      sdkAccessToken = tokens.accessToken;
    }
  } catch {
    // 未サインインなど
  }

  for (let i = 0; i < updated.length; i++) {
    const acc = updated[i];
    const emailKey = acc.email.trim().toLowerCase();

    const tokenFresh =
      acc.expiresIn != null &&
      acc.issuedAt != null &&
      acc.issuedAt + acc.expiresIn - 180 > now;

    if (tokenFresh) {
      result.push({ email: acc.email, accessToken: acc.accessToken });
      continue;
    }

    if (sdkEmail === emailKey && sdkAccessToken) {
      const newAcc: StoredAccount = {
        email: acc.email,
        accessToken: sdkAccessToken,
        issuedAt: now,
        expiresIn: 3600,
        refreshToken: undefined,
      };
      updated[i] = newAcc;
      needsSave = true;
      result.push({ email: acc.email, accessToken: sdkAccessToken });
    }
  }

  if (needsSave) {
    await saveLinkedAccounts(updated);
  }
  return result;
}
