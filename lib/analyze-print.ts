/**
 * プリント画像を Gemini API で解析し、「お知らせ」か「テスト」かを判定してデータを抽出する
 */

import { GoogleGenAI } from '@google/genai';
import type { AnalyzeResult, OshiraseEventItem } from './types';

// 仕様では "gemini-3-flash-preview"。未対応の場合は "gemini-2.0-flash" などに変更してください。
const MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `あなたは学校から配布されるプリントを分析するアシスタントです。
画像を見て、次のいずれかに分類し、指定のJSON形式のみで答えてください。

【お知らせプリントの場合】
行事・保護者会・参観日・配布物の説明など、イベントや日付が書かれたプリント。
- fullText: 画像に写っているプリントの全文を、読み取れる範囲で文字起こしした文字列（改行は\\nで表現）。タイトル・本文・日付・注意書きなど、書かれている内容をできるだけ漏らさず含めてください。
- プリント内に複数の行事や日程がある場合は、すべてを events 配列に含めてください（1件だけの場合も配列で1要素）。
- 各要素: eventName（イベント名）、eventDate（開始日時をISO 8601形式、例 2025-03-15T10:00:00）、eventEndDate（終了日時が分かればISO 8601、分からなければ省略可）、memo（補足があれば）。
- type: "お知らせ"、fullText: "（全文文字起こし）"、events: [ 上記のオブジェクトの配列 ]

【テスト・問題プリントの場合】
試験問題・ドリル・問題集のページなど、問題が複数あるプリント。
→ type: "テスト"、problems 配列に「1問目」「2問目」…のように問題ごとのテキストを切り分けて入れる。

返答は必ず次のJSONのみを出力してください。説明やマークダウンは不要です。
お知らせの例: {"type":"お知らせ","fullText":"〇〇小学校 保護者会のお知らせ\\n\\n日時 3月15日(金) 10:00～11:00\\n場所 体育館\\n...","events":[{"eventName":"授業参観","eventDate":"2025-03-15T10:00:00","eventEndDate":"2025-03-15T11:00:00","memo":"2年1组"}]}
テストの例: {"type":"テスト","problems":["1. 次の計算をしなさい。3+5=","2. りんごが5こ..."]}`;

function getApiKey(): string {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!key || key === 'your_api_key_here') {
    throw new Error(
      'EXPO_PUBLIC_GEMINI_API_KEY が設定されていません。.env に API キーを設定してください。'
    );
  }
  return key;
}

function parseEventItem(raw: unknown): OshiraseEventItem {
  const o = raw as Record<string, unknown>;
  const eventName = o?.eventName != null ? String(o.eventName) : '';
  const eventDate = o?.eventDate != null ? String(o.eventDate) : '';
  if (!eventName.trim() || !eventDate.trim()) {
    throw new Error('お知らせの各イベントに eventName と eventDate が必要です。');
  }
  return {
    eventName: eventName.trim(),
    eventDate: eventDate.trim(),
    eventEndDate: o?.eventEndDate != null ? String(o.eventEndDate).trim() : undefined,
    memo: o?.memo != null ? String(o.memo) : undefined,
  };
}

/**
 * 画像（base64）を送信して解析結果を取得する
 */
export async function analyzePrintImage(imageBase64: string, mimeType: string): Promise<AnalyzeResult> {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: SYSTEM_PROMPT },
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: imageBase64,
            },
          },
        ],
      },
    ],
  });

  const text = response.text?.trim() ?? '';
  if (!text) {
    throw new Error('Gemini API から応答がありませんでした。');
  }

  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  if (parsed.type === 'お知らせ') {
    const eventsRaw = parsed.events;
    if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) {
      throw new Error('お知らせの解析結果に events 配列（1件以上）が必要です。');
    }
    const events = eventsRaw.map((e) => parseEventItem(e));
    const fullText = parsed.fullText != null ? String(parsed.fullText) : '';
    return { type: 'お知らせ', fullText, events };
  }

  if (parsed.type === 'テスト') {
    const problems = Array.isArray(parsed.problems)
      ? (parsed.problems as unknown[]).map((p) => String(p))
      : [];
    return { type: 'テスト', problems };
  }

  throw new Error('解析結果の形式が不正です。');
}
