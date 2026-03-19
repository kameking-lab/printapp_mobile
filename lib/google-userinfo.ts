/**
 * Google Userinfo API（OAuth 連携アカウントのメール取得）
 */

const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export async function fetchGoogleUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Userinfo failed: ${res.status}`);
  const data = (await res.json()) as { email?: string };
  const email = data?.email?.trim();
  if (!email) throw new Error('メールアドレスを取得できませんでした。');
  return email;
}
