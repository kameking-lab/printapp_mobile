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

/** テスト・問題プリントの抽出結果 */
export interface TestResult {
  type: 'テスト';
  /** 問題ごとのテキスト（1問目、2問目...） */
  problems: string[];
}

export type AnalyzeResult = OshiraseResult | TestResult;
