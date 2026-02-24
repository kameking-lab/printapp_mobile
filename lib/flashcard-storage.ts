/**
 * フラッシュカードを科目別に AsyncStorage で保存・読み込み
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FlashcardItem, SavedDeck } from './types';

const STORAGE_KEY_PREFIX = '@printapp_flashcards_';
const SUBJECTS_LIST_KEY = '@printapp_flashcards_subjects';

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

/** 科目一覧を取得（保存済みデックの科目名） */
export async function getSubjectList(): Promise<string[]> {
  return getStoredSubjects();
}

/** 指定科目のデックを取得 */
export async function getDeck(subject: string): Promise<SavedDeck | null> {
  if (!subject.trim()) return null;
  try {
    const key = STORAGE_KEY_PREFIX + subject.trim();
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    const summaryTitle = typeof d.summaryTitle === 'string' ? d.summaryTitle : '';
    const subj = typeof d.subject === 'string' ? d.subject : subject;
    const date = typeof d.date === 'string' ? d.date : '';
    const savedAt = typeof d.savedAt === 'string' ? d.savedAt : '';
    const cardsRaw = Array.isArray(d.cards) ? d.cards : [];
    const cards: FlashcardItem[] = cardsRaw.map((c) => {
      const o = c as Record<string, unknown>;
      return {
        question: typeof o.question === 'string' ? o.question : '',
        answer: typeof o.answer === 'string' ? o.answer : undefined,
        imageUri: typeof o.imageUri === 'string' ? o.imageUri : undefined,
      };
    });
    return { summaryTitle, subject: subj, date, cards, savedAt };
  } catch {
    return null;
  }
}

/** 科目別にカードを保存（上書き） */
export async function saveDeck(deck: SavedDeck): Promise<void> {
  const key = STORAGE_KEY_PREFIX + deck.subject.trim();
  await AsyncStorage.setItem(key, JSON.stringify(deck));
  const subjects = await getStoredSubjects();
  if (!subjects.includes(deck.subject.trim())) {
    subjects.push(deck.subject.trim());
    await setStoredSubjects(subjects);
  }
}

/** 科目のデックを削除 */
export async function deleteDeck(subject: string): Promise<void> {
  const key = STORAGE_KEY_PREFIX + subject.trim();
  await AsyncStorage.removeItem(key);
  const subjects = await getStoredSubjects();
  const next = subjects.filter((s) => s !== subject.trim());
  await setStoredSubjects(next);
}
