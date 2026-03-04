/**
 * プリント画像を Gemini API で解析し、「お知らせ」か「テスト」かを判定してデータを抽出する
 */

import { GoogleGenAI } from '@google/genai';
import type {
  AnalyzeResult,
  OshiraseEventItem,
  TestProblemItem,
  ImageRegion,
  RedactionBox,
} from './types';

// 仕様では "gemini-3-flash-preview"。未対応の場合は "gemini-2.0-flash" などに変更してください。
const MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `あなたは学校から配布されるプリントを分析するアシスタントです。
【重要】画像の内容をよく見て、次のどちらかに必ず分類してください。
・「お知らせ」: 行事案内・保護者会・参観日・配布物の説明・お知らせ文書など、イベントや日程が書かれたプリント。問題番号や計算式・穴埋め・選択肢が並んだ問題用紙ではないもの。
・「テスト」: 試験問題・ドリル・問題集のページなど、問題番号（1. 2. や ① ② など）が付いた問題が複数あるプリント。
複数枚の画像のうちお知らせプリントは必ず「お知らせ」として返し、テスト問題用紙と誤認しないでください。

【お知らせプリントの場合】
- fullText: 画像に写っているプリントの全文を、読み取れる範囲で文字起こし（改行は\\n）。タイトル・本文・日付・注意書きを含める。
- プリント内の複数の行事・予定をすべて events 配列に含める（1件だけでも配列で1要素）。各要素: eventName（予定のタイトル・イベント名）、eventDate（開始日時をISO 8601形式、例 2025-03-15T10:00:00）、eventEndDate（終了日時が分かればISO 8601、省略可）、memo（補足）。
- type: "お知らせ"、fullText、events: [ { eventName, eventDate, eventEndDate?, memo? }, ... ]

【テスト・問題プリントの場合】
試験問題・ドリル・問題集のページなど、問題が複数あるプリント。
- 絶対にすべての問題を漏らさず抽出すること。番号が振られているもの（1. 2. 3. や ① ② や (1) (2) など）は、すべて独立した1問として problems 配列に含めること。問題が10問あれば配列は10要素にすること。
- 【最重要・大問の前提補完】大問（共通の図形・長文の前提・「次の図を見て問いに答えなさい」などの共通条件）があり、それに紐づく小問（問1、問2…）がある場合、小問の text だけでは問題が成立しません。必ず各小問の text の冒頭に、「共通の前提文・図形の説明・条件」を毎回コピーして含め、その問題単体で解ける状態にして出力すること。例：「次の図でAB＝ACである。問1 角xの大きさを求めなさい。」のように、大問の内容を小問ごとに含めること。
- 各問題について、次の情報を必ず含めてください:
  - text: 問題文（文字列）。上記のとおり大問の前提が存在する場合はその内容を冒頭に含めること。
  - correctAnswer: 正しい模範解答（文字列）
  - choices: 3〜4個の選択肢（文字列の配列）。必ず correctAnswer を1つ含めること。プリントに不正解の選択肢が書かれていない場合（未解答のテスト・白紙・記述式）でも、AI自身が文脈から「もっともらしい不正解の選択肢（ダミー）」を自動生成し、必ず3〜4つの choices を埋めること。記述式の場合は正答に加えて2〜3個の典型的な誤答例を生成すること。
  - explanation: その問題の簡単な解説を1〜2文で（なぜその答えになるか、ポイントなど）。省略可だが、可能な限り付けてください。
  - imageRegion: 図形・グラフ・図表が含まれる問題の場合に【必須】。対象の問題文と、それに付随する図形・グラフ・表を【すべて過不足なく】含む正確なバウンディングボックスを指定すること。ギリギリで見切れないよう、上下左右に約5%（0.05）の余白（マージン）を含めた正規化座標（0.0〜1.0）で { "ymin", "xmin", "ymax", "xmax" } を計算すること。無関係な他問題の図や本文は絶対に含めないこと。テキストのみで図のない問題は imageRegion を省略可。
  - summaryTitle: テストの要約タイトル（例: 第2回計算テスト、漢字ドリルp.10）。分からなければ空文字。
  - subject: 科目（例: 算数、国語、理科）。分からなければ空文字。
  - date: 日付が書いてあれば YYYY-MM-DD、なければ空文字。
- 【復習用PDF用】redaction_boxes: 画像上で「生徒が書き込んだ解答」または「正解が印字されている部分」を覆う矩形の配列。解答が一切書かれていない（未解答・白紙の新しいテスト）の場合は空配列 [] で返すこと。隠すべきヒントや部分的な印字解答がある箇所のみ枠を生成してもよい。枠を出す場合は、文字のインク部分だけを極限までタイトに囲むこと（現在より20%程度小さく、周囲の問題文を絶対に巻き込まない）。画像全体の幅・高さを100%とした相対座標（0.0〜100.0）で、各要素は { "x_percent", "y_percent", "width_percent", "height_percent" }。
- type: "テスト"、summaryTitle、subject、date、problems: [ ... ]、redaction_boxes: [ { "x_percent", "y_percent", "width_percent", "height_percent" }, ... ] の形式とします。

返答は必ず次のJSONのみを出力してください。説明やマークダウンは不要です。
お知らせの例: {"type":"お知らせ","fullText":"〇〇小学校 保護者会のお知らせ\\n\\n日時 3月15日(金) 10:00～11:00\\n場所 体育館\\n...","events":[{"eventName":"授業参観","eventDate":"2025-03-15T10:00:00","eventEndDate":"2025-03-15T11:00:00","memo":"2年1组"}]}
テストの例: {"type":"テスト","summaryTitle":"計算テスト","subject":"算数","date":"2025-03-15","problems":[{"text":"1. 3+5を計算しなさい。","correctAnswer":"8","choices":["8","7","9"],"explanation":"3と5を足すと8になります。"},{"text":"2. 次の図の角度を求めなさい。","correctAnswer":"90度","choices":["90度","60度","45度"],"explanation":"直角は90度です。","imageRegion":{"ymin":0.25,"xmin":0.1,"ymax":0.6,"xmax":0.9}}],"redaction_boxes":[{"x_percent":15.5,"y_percent":22.0,"width_percent":12.0,"height_percent":5.0},{"x_percent":15.5,"y_percent":45.0,"width_percent":25.0,"height_percent":8.0}]}`;

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

function parseImageRegion(raw: unknown): ImageRegion | undefined {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r.ymin !== 'number' || typeof r.xmin !== 'number' || typeof r.ymax !== 'number' || typeof r.xmax !== 'number') return undefined;
  const ymin = Math.max(0, Math.min(1, r.ymin));
  const xmin = Math.max(0, Math.min(1, r.xmin));
  const ymax = Math.max(0, Math.min(1, r.ymax));
  const xmax = Math.max(0, Math.min(1, r.xmax));
  if (ymax <= ymin || xmax <= xmin) return undefined;
  return { ymin, xmin, ymax, xmax };
}

/** 選択肢が不足している場合にダミーを補い、必ず3〜4件にする（未解答・記述式対応） */
function ensureChoices(choices: string[], correctAnswer: string): string[] {
  let list = [...choices];
  if (!list.includes(correctAnswer)) {
    list.push(correctAnswer);
  }
  list = Array.from(new Set(list));
  while (list.length < 3) {
    list.push(`（選択肢${list.length + 1}）`);
  }
  if (list.length > 4) {
    list = list.slice(0, 4);
  }
  return list;
}

function parseProblemItem(raw: unknown): TestProblemItem {
  const o = raw as Record<string, unknown>;
  const text = o?.text != null ? String(o.text).trim() : '';
  if (!text) {
    throw new Error('テストの各問題に text が必要です。');
  }
  const imageRegion = o?.imageRegion != null ? parseImageRegion(o.imageRegion) : undefined;
  const correct = o?.correctAnswer != null ? String(o.correctAnswer).trim() : '';
  if (!correct) {
    throw new Error('テストの各問題に correctAnswer が必要です。');
  }
  const choicesRaw = o?.choices;
  let choices: string[] = [];
  if (Array.isArray(choicesRaw)) {
    choices = choicesRaw
      .map((c) => String(c).trim())
      .filter((c) => c.length > 0);
  }
  choices = ensureChoices(choices, correct);
  const explanation =
    o?.explanation != null && String(o.explanation).trim() !== ''
      ? String(o.explanation).trim()
      : undefined;
  return { text, imageRegion, correctAnswer: correct, choices, explanation };
}

/** 白抜き枠はLLMの座標をそのまま使用。プロンプトで「タイトに囲む」指示を出しているため、フロントでの縮小補正は行わない */
function parseRedactionBox(raw: unknown): RedactionBox | null {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r.x_percent !== 'number' || typeof r.y_percent !== 'number' || typeof r.width_percent !== 'number' || typeof r.height_percent !== 'number') return null;
  const x = Math.max(0, Math.min(100, Number(r.x_percent)));
  const y = Math.max(0, Math.min(100, Number(r.y_percent)));
  const w = Math.max(0, Math.min(100 - x, Number(r.width_percent)));
  const h = Math.max(0, Math.min(100 - y, Number(r.height_percent)));
  if (w <= 0 || h <= 0) return null;
  return { x_percent: x, y_percent: y, width_percent: w, height_percent: h };
}

function parseRedactionBoxes(raw: unknown): RedactionBox[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => parseRedactionBox(item)).filter((b): b is RedactionBox => b !== null);
}

/**
 * 画像（base64）を送信して解析結果を取得する。
 * API エラー・パースエラー時は必ず Error をスローし、呼び出し元で Alert 表示して復帰できるようにする。
 */
export async function analyzePrintImage(imageBase64: string, mimeType: string): Promise<AnalyzeResult> {
  try {
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
    try {
      return parseAnalyzeResponse(text);
    } catch (parseError) {
      console.warn('[analyze-print] Parse error', parseError);
      throw new Error('解析結果の形式が不正です。もう一度お試しください。');
    }
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error('解析に失敗しました。');
  }
}

function parseAnalyzeResponse(responseText: string): AnalyzeResult {
  let jsonStr = responseText;
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    throw new Error('解析結果のJSON形式が不正です。');
  }

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
    const problemsRaw = parsed.problems;
    if (!Array.isArray(problemsRaw)) {
      throw new Error('テストの解析結果に problems 配列が必要です。');
    }
    const problems: TestProblemItem[] = problemsRaw.map((p) => parseProblemItem(p));
    const summaryTitle = parsed.summaryTitle != null ? String(parsed.summaryTitle).trim() : '';
    const subject = parsed.subject != null ? String(parsed.subject).trim() : '';
    const date = parsed.date != null ? String(parsed.date).trim() : '';
    const redaction_boxes = parseRedactionBoxes(parsed.redaction_boxes);
    return { type: 'テスト', summaryTitle, subject, date, problems, redaction_boxes };
  }

  throw new Error('解析結果の形式が不正です。');
}

/**
 * 同一画像に対してユーザーの追加指示で再解析する（例：イベント名の形式統一など）
 */
export async function reAnalyzeWithPrompt(
  imageBase64: string,
  mimeType: string,
  userPrompt: string
): Promise<AnalyzeResult> {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const userMessage =
    SYSTEM_PROMPT +
    '\n\n【ユーザーからの追加指示（この指示に従って画像を再解析し、同じJSON形式で出力してください）】\n' +
    userPrompt.trim();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: userMessage },
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
  try {
    return parseAnalyzeResponse(text);
  } catch (parseError) {
    console.warn('[analyze-print] Re-analyze parse error', parseError);
    throw new Error('再解析結果の形式が不正です。もう一度お試しください。');
  }
}
