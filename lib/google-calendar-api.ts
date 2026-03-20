/**
 * Google Calendar API（REST）によるカレンダー一覧取得・イベント作成
 * 高速モード（ルートB）で使用。OAuth の access_token を渡す。
 */

const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars';

export interface ApiCalendarItem {
  id: string;
  summary: string;
  accessRole?: string;
}

/**
 * Expo AuthSession（ネイティブ OAuth）用の Google OAuth Client ID。
 * - iOS: ネイティブ用クライアント ID（EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS）
 * - Android: Android 用クライアント ID（EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID）を使用する。
 *   未設定時は本番用 Android クライアント ID にフォールバックする。
 */
const ANDROID_AUTH_SESSION_CLIENT_ID_FALLBACK =
  '937444991341-63p8ouajb29m7jnihkd70makq5he7mkq.apps.googleusercontent.com';

export function getGoogleOAuthClientId(platform: 'ios' | 'android'): string {
  if (platform === 'ios') {
    const id = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS?.trim();
    if (id) return id;
    console.error(
      '[Google OAuth] iOS Client ID が未設定です。.env に EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS を設定してください。起動は継続しますが Google ログインは利用できません。'
    );
    return '';
  }
  return (
    process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID?.trim() ||
    ANDROID_AUTH_SESSION_CLIENT_ID_FALLBACK
  );
}

async function apiFetch(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res;
}

/**
 * 書き込み可能なカレンダー一覧を取得（accessRole が owner または writer）
 */
export async function fetchWritableCalendarList(accessToken: string): Promise<ApiCalendarItem[]> {
  const items: ApiCalendarItem[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(CALENDAR_LIST_URL);
    url.searchParams.set('minAccessRole', 'writer');
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await apiFetch(url.toString(), accessToken);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Calendar list failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      items?: { id: string; summary?: string; accessRole?: string }[];
      nextPageToken?: string;
    };
    for (const c of data.items ?? []) {
      items.push({
        id: c.id,
        summary: c.summary ?? c.id,
        accessRole: c.accessRole,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

export interface CreateEventPayload {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string } | { date: string };
  end: { dateTime: string; timeZone: string } | { date: string };
  colorId?: string;
  reminders?: { useDefault: boolean; overrides: { method: 'popup'; minutes: number }[] };
}

/**
 * 指定カレンダーにイベントを1件作成
 */
export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  payload: CreateEventPayload
): Promise<string> {
  const url = `${CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events`;
  const res = await apiFetch(url, accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create event failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? '';
}
