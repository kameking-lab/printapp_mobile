/**
 * 単語帳タブ - 科目一覧とフラッシュカード（タップで裏返し）
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getSubjectList, getDeck, deleteDeck } from '@/lib/flashcard-storage';
import type { SavedDeck } from '@/lib/types';

export default function FlashcardsScreen() {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeck, setSelectedDeck] = useState<SavedDeck | null>(null);
  const [deckIndex, setDeckIndex] = useState(0);
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const { width } = useWindowDimensions();

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getSubjectList();
      setSubjects(list);
      setSelectedDeck(null);
    } catch {
      setSubjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  const openDeck = useCallback(async (subject: string) => {
    try {
      const deck = await getDeck(subject);
      if (deck) {
        setSelectedDeck(deck);
        setDeckIndex(0);
        setFlipped({});
      }
    } catch {
      Alert.alert('エラー', 'デックを開けませんでした。');
    }
  }, []);

  const deleteDeckConfirm = useCallback((subject: string) => {
    Alert.alert(
      '削除',
      `「${subject}」の単語帳を削除しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            await deleteDeck(subject);
            if (selectedDeck?.subject === subject) {
              setSelectedDeck(null);
            }
            loadSubjects();
          },
        },
      ]
    );
  }, [selectedDeck?.subject, loadSubjects]);

  const goBack = useCallback(() => {
    setSelectedDeck(null);
  }, []);

  const flipCard = useCallback((index: number) => {
    setFlipped((prev) => ({ ...prev, [index]: !prev[index] }));
  }, []);

  const nextCard = useCallback(() => {
    if (!selectedDeck) return;
    setDeckIndex((i) => (i + 1) % selectedDeck.cards.length);
  }, [selectedDeck]);

  const prevCard = useCallback(() => {
    if (!selectedDeck) return;
    const len = selectedDeck.cards.length;
    setDeckIndex((i) => (i - 1 + len) % len);
  }, [selectedDeck]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedView style={styles.center}>
          <ActivityIndicator size="large" color="#7cb342" />
          <ThemedText style={styles.loadingText}>読み込み中…</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  if (selectedDeck) {
    const cards = selectedDeck.cards;
    const current = cards[deckIndex];
    const isFlipped = flipped[deckIndex];
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedView style={styles.container}>
          <View style={styles.deckHeader}>
            <TouchableOpacity onPress={goBack} style={styles.backButton} activeOpacity={0.8}>
              <ThemedText style={styles.backButtonText}>← 一覧</ThemedText>
            </TouchableOpacity>
            <ThemedText style={styles.deckTitle} numberOfLines={1}>
              {selectedDeck.subject} / {selectedDeck.summaryTitle || '単語帳'}
            </ThemedText>
            <ThemedText style={styles.deckMeta}>
              {deckIndex + 1} / {cards.length}
            </ThemedText>
          </View>
          <TouchableOpacity
            style={styles.cardTouchable}
            onPress={() => flipCard(deckIndex)}
            activeOpacity={1}
          >
            <View style={[styles.card, { width: width - 48 }]}>
              {current.imageUri ? (
                <View style={styles.cardImageWrap}>
                  <Image source={{ uri: current.imageUri }} style={styles.cardImage} contentFit="contain" />
                </View>
              ) : null}
              <ThemedText style={styles.cardQuestion} numberOfLines={isFlipped ? 20 : 6}>
                {current.question}
              </ThemedText>
              {isFlipped ? (
                <View style={styles.answerBox}>
                  <ThemedText style={styles.answerLabel}>答え</ThemedText>
                  <ThemedText style={styles.cardAnswer}>{current.answer || '（答えをメモできます）'}</ThemedText>
                </View>
              ) : (
                <ThemedText style={styles.tapHint}>タップで答えを表示</ThemedText>
              )}
            </View>
          </TouchableOpacity>
          <View style={styles.navRow}>
            <TouchableOpacity style={styles.navButton} onPress={prevCard} activeOpacity={0.8}>
              <ThemedText style={styles.navButtonText}>← 前</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.navButton} onPress={nextCard} activeOpacity={0.8}>
              <ThemedText style={styles.navButtonText}>次 →</ThemedText>
            </TouchableOpacity>
          </View>
        </ThemedView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.title}>
          単語帳
        </ThemedText>
        <ThemedText style={styles.subtitle}>
          保存したフラッシュカードを科目別に表示します。
        </ThemedText>
        {subjects.length === 0 ? (
          <ThemedText style={styles.emptyText}>
            まだ保存された単語帳はありません。{'\n'}
            ホームでテストを解析し「フラッシュカードに保存」してください。
          </ThemedText>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {subjects.map((subject) => (
              <TouchableOpacity
                key={subject}
                style={styles.subjectCard}
                onPress={() => openDeck(subject)}
                onLongPress={() => deleteDeckConfirm(subject)}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.subjectTitle}>{subject}</ThemedText>
                <ThemedText style={styles.subjectHint}>タップで開く / 長押しで削除</ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#faf8f5',
  },
  container: {
    flex: 1,
    backgroundColor: '#faf8f5',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#6b6b6b',
  },
  title: {
    marginBottom: 8,
    color: '#2d5016',
    paddingHorizontal: 20,
  },
  subtitle: {
    marginBottom: 20,
    opacity: 0.9,
    color: '#5a6c54',
    paddingHorizontal: 20,
  },
  emptyText: {
    paddingHorizontal: 20,
    color: '#6b6b6b',
    lineHeight: 22,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  subjectCard: {
    backgroundColor: '#fffefb',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(124, 179, 66, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  subjectTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2d5016',
  },
  subjectHint: {
    fontSize: 12,
    color: '#8a8a8a',
    marginTop: 4,
  },
  deckHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 12,
  },
  backButtonText: {
    color: '#7cb342',
    fontSize: 16,
  },
  deckTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#2d5016',
  },
  deckMeta: {
    fontSize: 14,
    color: '#6b6b6b',
  },
  cardTouchable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fffefb',
    borderRadius: 20,
    padding: 24,
    minHeight: 280,
    borderWidth: 1,
    borderColor: 'rgba(124, 179, 66, 0.25)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardImageWrap: {
    width: '100%',
    height: 120,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardQuestion: {
    fontSize: 16,
    lineHeight: 24,
    color: '#333',
  },
  tapHint: {
    marginTop: 16,
    fontSize: 13,
    color: '#7cb342',
  },
  answerBox: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  answerLabel: {
    fontSize: 12,
    color: '#7cb342',
    marginBottom: 4,
  },
  cardAnswer: {
    fontSize: 15,
    lineHeight: 22,
    color: '#555',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  navButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 179, 66, 0.2)',
  },
  navButtonText: {
    color: '#2d5016',
    fontSize: 16,
    fontWeight: '600',
  },
});
