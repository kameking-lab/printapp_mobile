/**
 * フラッシュカードを「科目 ＞ プリント別」で AsyncStorage に保存・読み込み
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeckScore, FlashcardItem, ImageRegion, RedactionBox, SavedDeck } from './types';

const STORAGE_KEY_PREFIX = '@printapp_flashcards_';
const SUBJECTS_LIST_KEY = '@printapp_flashcards_subjects';

function subjectToKey(subject: string): string {
  return STORAGE_KEY_PREFIX + subject.trim();
}

async function getStoredSubjects(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SUBJECTS_LIST_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

async function setStoredSubjects(subjects: string[]): Promise<void> {
  await AsyncStorage.setItem(SUBJECTS_LIST_KEY, JSON.stringify(subjects));
}

function parseImageRegion(r: unknown): ImageRegion | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const o = r as Record<string, unknown>;
  const ymin = typeof o.ymin === 'number' ? o.ymin : NaN;
  const xmin = typeof o.xmin === 'number' ? o.xmin : NaN;
  const ymax = typeof o.ymax === 'number' ? o.ymax : NaN;
  const xmax = typeof o.xmax === 'number' ? o.xmax : NaN;
  if (!Number.isFinite(ymin) || !Number.isFinite(xmin) || !Number.isFinite(ymax) || !Number.isFinite(xmax))
    return undefined;
  return { ymin, xmin, ymax, xmax };
}

function parseRedactionBox(r: unknown): RedactionBox | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const x_percent = typeof o.x_percent === 'number' ? o.x_percent : NaN;
  const y_percent = typeof o.y_percent === 'number' ? o.y_percent : NaN;
  const width_percent = typeof o.width_percent === 'number' ? o.width_percent : NaN;
  const height_percent = typeof o.height_percent === 'number' ? o.height_percent : NaN;
  if (
    !Number.isFinite(x_percent) ||
    !Number.isFinite(y_percent) ||
    !Number.isFinite(width_percent) ||
    !Number.isFinite(height_percent)
  )
    return null;
  return { x_percent, y_percent, width_percent, height_percent };
}

function parseCard(o: Record<string, unknown>): FlashcardItem {
  const base: FlashcardItem = {
    question: typeof o.question === 'string' ? o.question : '',
    answer: typeof o.answer === 'string' ? o.answer : undefined,
    explanation:
      o.explanation != null && String(o.explanation).trim() !== ''
        ? String(o.explanation).trim()
        : undefined,
    imageUri: typeof o.imageUri === 'string' ? o.imageUri : undefined,
    imageRegion: parseImageRegion(o.imageRegion),
  };
  const choicesRaw = Array.isArray(o.choices) ? o.choices : [];
  const choices = choicesRaw
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
  const correctAnswer =
    o.correctAnswer != null && typeof o.correctAnswer === 'string'
      ? (o.correctAnswer as string)
      : undefined;
  return {
    ...base,
    choices: choices.length > 0 ? choices : undefined,
    correctAnswer,
  };
}

function parseDeck(d: Record<string, unknown>, subject: string): SavedDeck | null {
  const deckId = typeof d.deckId === 'string' ? d.deckId : '';
  const printTitle = typeof d.printTitle === 'string' ? d.printTitle : '';
  if (!deckId || !printTitle) return null;
  const summaryTitle = typeof d.summaryTitle === 'string' ? d.summaryTitle : '';
  const date = typeof d.date === 'string' ? d.date : '';
  const savedAt = typeof d.savedAt === 'string' ? d.savedAt : '';
  const cardsRaw = Array.isArray(d.cards) ? d.cards : [];
  const cards = cardsRaw.map((c) => parseCard(c as Record<string, unknown>));
  let lastScore: DeckScore | undefined;
  const scoreRaw = d.lastScore as Record<string, unknown> | undefined;
  if (scoreRaw && typeof scoreRaw === 'object') {
    const correct = typeof scoreRaw.correct === 'number' ? scoreRaw.correct : NaN;
    const total = typeof scoreRaw.total === 'number' ? scoreRaw.total : NaN;
    const percentage = typeof scoreRaw.percentage === 'number' ? scoreRaw.percentage : NaN;
    const takenAt = typeof scoreRaw.takenAt === 'string' ? scoreRaw.takenAt : '';
    if (
      Number.isFinite(correct) &&
      Number.isFinite(total) &&
      total > 0 &&
      Number.isFinite(percentage) &&
      takenAt
    ) {
      lastScore = { correct, total, percentage, takenAt };
    }
  }
  const redactionBoxesRaw = Array.isArray(d.redaction_boxes) ? d.redaction_boxes : [];
  const redaction_boxes = redactionBoxesRaw
    .map((r) => parseRedactionBox(r))
    .filter((b): b is RedactionBox => b != null);
  return {
    deckId,
    printTitle,
    summaryTitle,
    subject,
    date,
    cards,
    savedAt,
    lastScore,
    redaction_boxes: redaction_boxes.length > 0 ? redaction_boxes : undefined,
  };
}

/** 科目一覧を取得 */
export async function getSubjectList(): Promise<string[]> {
  return getStoredSubjects();
}

/** 指定科目内のプリント（デック）一覧を取得（旧形式: 1科目1デックの場合は配列に変換） */
export async function getDecksForSubject(subject: string): Promise<SavedDeck[]> {
  if (!subject.trim()) return [];
  try {
    const key = subjectToKey(subject);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const subj = subject.trim();
    let arr: Record<string, unknown>[];
    if (Array.isArray(parsed)) {
      arr = parsed as Record<string, unknown>[];
    } else if (parsed && typeof parsed === 'object') {
      arr = [parsed as Record<string, unknown>];
    } else {
      return [];
    }
    return arr
      .map((d) => {
        const deck = parseDeck(d, subj);
        if (deck) return deck;
        const legacy = parseLegacyDeck(d, subj);
        return legacy;
      })
      .filter((d): d is SavedDeck => d != null);
  } catch {
    return [];
  }
}

function parseLegacyDeck(d: Record<string, unknown>, subject: string): SavedDeck | null {
  const savedAt = typeof d.savedAt === 'string' ? d.savedAt : '';
  const summaryTitle = typeof d.summaryTitle === 'string' ? d.summaryTitle : '';
  const date = typeof d.date === 'string' ? d.date : '';
  const cardsRaw = Array.isArray(d.cards) ? d.cards : [];
  const cards = cardsRaw.map((c) => parseCard(c as Record<string, unknown>));
  if (!savedAt && cards.length === 0) return null;
  const deckId = typeof d.deckId === 'string' ? d.deckId : (savedAt || String(Date.now()));
  let printTitle = typeof d.printTitle === 'string' ? d.printTitle : '';
  if (!printTitle && savedAt) {
    try {
      const t = new Date(savedAt);
      const y = t.getFullYear();
      const m = String(t.getMonth() + 1).padStart(2, '0');
      const day = String(t.getDate()).padStart(2, '0');
      const h = String(t.getHours()).padStart(2, '0');
      const min = String(t.getMinutes()).padStart(2, '0');
      printTitle = `${y}/${m}/${day} ${h}:${min}のプリント`;
    } catch {
      printTitle = summaryTitle || '保存したプリント';
    }
  }
  if (!printTitle) printTitle = summaryTitle || '保存したプリント';
  let lastScore: DeckScore | undefined;
  const scoreRaw = d.lastScore as Record<string, unknown> | undefined;
  if (scoreRaw && typeof scoreRaw === 'object') {
    const correct = typeof scoreRaw.correct === 'number' ? scoreRaw.correct : NaN;
    const total = typeof scoreRaw.total === 'number' ? scoreRaw.total : NaN;
    const percentage = typeof scoreRaw.percentage === 'number' ? scoreRaw.percentage : NaN;
    const takenAt = typeof scoreRaw.takenAt === 'string' ? scoreRaw.takenAt : '';
    if (Number.isFinite(correct) && Number.isFinite(total) && total > 0 && Number.isFinite(percentage) && takenAt) {
      lastScore = { correct, total, percentage, takenAt };
    }
  }
  return { deckId, printTitle, summaryTitle, subject, date, cards, savedAt: savedAt || new Date().toISOString(), lastScore };
}

/** 指定科目・deckId のデックを1件取得 */
export async function getDeck(subject: string, deckId: string): Promise<SavedDeck | null> {
  const decks = await getDecksForSubject(subject);
  return decks.find((d) => d.deckId === deckId) ?? null;
}

/** プリント1件を保存（科目内に追加または同deckIdで上書き） */
export async function saveDeck(deck: SavedDeck): Promise<void> {
  const subject = deck.subject.trim();
  const key = subjectToKey(subject);
  try {
    const list = await getDecksForSubject(subject);
    const idx = list.findIndex((d) => d.deckId === deck.deckId);
    const next = [...list];
    if (idx >= 0) next[idx] = deck;
    else next.push(deck);
    await AsyncStorage.setItem(key, JSON.stringify(next));
    const subjects = await getStoredSubjects();
    if (!subjects.includes(subject)) {
      subjects.push(subject);
      await setStoredSubjects(subjects);
    }
    console.log('[Flashcards] saveDeck', { subject, deckId: deck.deckId, printTitle: deck.printTitle, cardsCount: deck.cards.length });
  } catch (e) {
    console.error('[Flashcards] saveDeck failed', e);
    throw e;
  }
}

/** 科目内のプリント1件を削除 */
export async function deleteDeck(subject: string, deckId: string): Promise<void> {
  const key = subjectToKey(subject);
  const list = await getDecksForSubject(subject);
  const next = list.filter((d) => d.deckId !== deckId);
  if (next.length === 0) {
    await AsyncStorage.removeItem(key);
    const subjects = await getStoredSubjects();
    await setStoredSubjects(subjects.filter((s) => s !== subject.trim()));
  } else {
    await AsyncStorage.setItem(key, JSON.stringify(next));
  }
}

/** 直近スコアを更新 */
export async function updateDeckScore(subject: string, deckId: string, score: DeckScore): Promise<void> {
  const deck = await getDeck(subject, deckId);
  if (!deck) return;
  const next: SavedDeck = { ...deck, lastScore: score };
  await saveDeck(next);
}
