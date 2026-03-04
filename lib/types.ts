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

/** 復習用PDF用：解答欄を白塗りする領域（画像全体に対する相対座標 0〜100） */
export interface RedactionBox {
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
}

/** テストの1問分（テキスト + オプションで図形領域・選択肢・解説） */
export interface TestProblemItem {
  /** 問題文テキスト */
  text: string;
  /** 図形・グラフがある場合の画像内領域（0〜1）。省略可 */
  imageRegion?: ImageRegion;
  /** 正しい模範解答（文字列） */
  correctAnswer: string;
  /** ダミーを含む3〜4個の選択肢（必ず correctAnswer を含む） */
  choices: string[];
  /** 簡単な解説（1〜2文）。省略可 */
  explanation?: string;
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
  /** 復習用PDF用：解答欄の白塗り座標（1枚解析時のAPI返却。複数画像時は index で testImageData を使用） */
  redaction_boxes?: RedactionBox[];
  /** 復習用PDF用：画像ごとのURI・base64・白塗り座標（マージ後に index で設定） */
  testImageData?: { uri: string; base64: string; redaction_boxes: RedactionBox[] }[];
}

export type AnalyzeResult = OshiraseResult | TestResult;

// --- フラッシュカード保存用 ---

/** 1枚のフラッシュカード */
export interface FlashcardItem {
  /** 問題（表面） */
  question: string;
  /** 答え（裏面）。任意 */
  answer?: string;
  /** 簡単な解説。任意 */
  explanation?: string;
  /** 切り抜き画像のURI（図形問題用） */
  imageUri?: string;
  /** 切り抜き領域（0〜1）。白塗りオーバーレイの座標変換用 */
  imageRegion?: ImageRegion;
  /** 選択肢（クイズ用）。任意 */
  choices?: string[];
  /** 正解の選択肢テキスト。任意 */
  correctAnswer?: string;
}

/** 単語帳の直近スコア */
export interface DeckScore {
  correct: number;
  total: number;
  percentage: number;
  takenAt: string;
}

/** 科目別に保存した「1回分のプリント」デック（科目 ＞ プリント別の階層） */
export interface SavedDeck {
  /** 一意ID（例: タイムスタンプ） */
  deckId: string;
  /** 一覧表示用タイトル（例: "2026/02/28 19:26のプリント"） */
  printTitle: string;
  summaryTitle: string;
  subject: string;
  date: string;
  cards: FlashcardItem[];
  /** 保存日時（ISO） */
  savedAt: string;
  /** 直近の学習スコア（任意） */
  lastScore?: DeckScore;
  /** 復習用：解答隠蔽の白塗り枠（画像全体 0〜100%）。オーバーレイ表示のフェイルセーフ用 */
  redaction_boxes?: RedactionBox[];
}
