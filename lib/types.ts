/**
 * プリント解析結果の型定義
 */

/** お知らせの1件分のイベント情報 */
export interface OshiraseEventItem {
  /** イベント名 */
  eventName: string;
  /** 開始日時（ISO 8601 形式、例: 2025-03-15T10:00:00） */
  eventDate: string;
  /** 終了日時（ISO 8601 形式。省略時は開始の1時間後として扱う） */
  eventEndDate?: string;
  /** メモ（任意） */
  memo?: string;
}

/** お知らせプリントの抽出結果（複数イベント対応） */
export interface OshiraseResult {
  type: 'お知らせ';
  /** 画像から読み取ったプリント全文の文字起こし */
  fullText: string;
  events: OshiraseEventItem[];
}

/** 画像内の領域（0〜1の正規化座標）。図形・グラフの切り抜き用 */
export interface ImageRegion {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

/** テストの1問分（テキスト + オプションで図形領域） */
export interface TestProblemItem {
  /** 問題文テキスト */
  text: string;
  /** 図形・グラフがある場合の画像内領域（0〜1）。省略可 */
  imageRegion?: ImageRegion;
}

/** テスト・問題プリントの抽出結果 */
export interface TestResult {
  type: 'テスト';
  /** テストの要約タイトル（例: 第2回計算テスト） */
  summaryTitle?: string;
  /** 科目（例: 算数、国語） */
  subject?: string;
  /** 日付（例: 2025-03-15） */
  date?: string;
  /** 問題ごとのテキストとオプションで図形領域 */
  problems: TestProblemItem[];
}

export type AnalyzeResult = OshiraseResult | TestResult;

// --- フラッシュカード保存用 ---

/** 1枚のフラッシュカード */
export interface FlashcardItem {
  /** 問題（表面） */
  question: string;
  /** 答え（裏面）。任意 */
  answer?: string;
  /** 切り抜き画像のURI（図形問題用） */
  imageUri?: string;
}

/** 科目別に保存したデックのメタ情報 + カード一覧 */
export interface SavedDeck {
  summaryTitle: string;
  subject: string;
  date: string;
  cards: FlashcardItem[];
  /** 保存日時（ISO） */
  savedAt: string;
}
