/**
 * 単語帳タブ - 科目 ＞ プリント別 ＞ カードの3段階UI
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
import { CroppedImageWithRedaction } from '@/components/cropped-image-with-redaction';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Pastel } from '@/constants/theme';
import {
  getSubjectList,
  getDecksForSubject,
  deleteDeck,
  updateDeckScore,
} from '@/lib/flashcard-storage';
import type { DeckScore, SavedDeck } from '@/lib/types';

export default function FlashcardsScreen() {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [decksInSubject, setDecksInSubject] = useState<SavedDeck[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<SavedDeck | null>(null);
  const [deckIndex, setDeckIndex] = useState(0);
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<'browse' | 'learn'>('browse');
  const [learnIndex, setLearnIndex] = useState(0);
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState<number | null>(null);
  const [quizAnswered, setQuizAnswered] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [isLearnFinished, setIsLearnFinished] = useState(false);
  const { width } = useWindowDimensions();

  const formatSavedAt = useCallback((iso: string | undefined): string => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${y}/${m}/${day} ${h}:${min}`;
    } catch {
      return '';
    }
  }, []);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getSubjectList();
      setSubjects(list);
      setSelectedSubject(null);
      setSelectedDeck(null);
      setDecksInSubject([]);
    } catch {
      setSubjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    if (!selectedSubject) {
      setDecksInSubject([]);
      return;
    }
    let cancelled = false;
    setLoadingDecks(true);
    getDecksForSubject(selectedSubject).then((decks) => {
      if (!cancelled) {
        setDecksInSubject(decks);
        setLoadingDecks(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSubject]);

  const openSubject = useCallback((subject: string) => {
    setSelectedSubject(subject);
    setSelectedDeck(null);
  }, []);

  const openDeck = useCallback((deck: SavedDeck) => {
    setSelectedDeck(deck);
    setDeckIndex(0);
    setFlipped({});
    setMode('browse');
    setLearnIndex(0);
    setSelectedChoiceIndex(null);
    setQuizAnswered(false);
    setCorrectCount(0);
    setIsLearnFinished(false);
  }, []);

  const goBackToSubjectList = useCallback(() => {
    setSelectedSubject(null);
    setDecksInSubject([]);
    setSelectedDeck(null);
  }, []);

  const goBackToDeckList = useCallback(() => {
    setSelectedDeck(null);
    setMode('browse');
  }, []);

  const deleteDeckConfirm = useCallback(
    (subject: string, deckId: string, printTitle: string) => {
      Alert.alert(
        '削除',
        `「${printTitle}」を削除しますか？`,
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '削除',
            style: 'destructive',
            onPress: async () => {
              await deleteDeck(subject, deckId);
              if (selectedDeck?.deckId === deckId) setSelectedDeck(null);
              setDecksInSubject((prev) => prev.filter((d) => d.deckId !== deckId));
              if (decksInSubject.length <= 1) setSelectedSubject(null);
            },
          },
        ]
      );
    },
    [selectedDeck?.deckId, decksInSubject.length]
  );

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

  const startLearnMode = useCallback(() => {
    if (!selectedDeck) return;
    setMode('learn');
    setLearnIndex(0);
    setSelectedChoiceIndex(null);
    setQuizAnswered(false);
    setCorrectCount(0);
    setIsLearnFinished(false);
  }, [selectedDeck]);

  const handleChoiceSelect = useCallback((index: number) => {
    setSelectedChoiceIndex(index);
    setQuizAnswered(true);
  }, []);

  const handleNextOrFinish = useCallback(async () => {
    if (!selectedDeck || selectedChoiceIndex == null || !quizAnswered) return;
    const cards = selectedDeck.cards;
    if (cards.length === 0) return;
    const card = cards[learnIndex];
    const choices = card.choices ?? [];
    if (!choices.length || selectedChoiceIndex < 0 || selectedChoiceIndex >= choices.length) return;
    const selectedText = choices[selectedChoiceIndex];
    const isCorrect = !!card.correctAnswer && selectedText === card.correctAnswer;
    const isLast = learnIndex === cards.length - 1;
    const nextCorrectTotal = correctCount + (isCorrect ? 1 : 0);
    setCorrectCount(nextCorrectTotal);
    setQuizAnswered(false);
    setSelectedChoiceIndex(null);

    if (isLast) {
      const total = cards.length;
      const percentage = total > 0 ? Math.round((nextCorrectTotal / total) * 100) : 0;
      const score: DeckScore = {
        correct: nextCorrectTotal,
        total,
        percentage,
        takenAt: new Date().toISOString(),
      };
      setIsLearnFinished(true);
      try {
        await updateDeckScore(selectedDeck.subject, selectedDeck.deckId, score);
        setSelectedDeck({ ...selectedDeck, lastScore: score });
        setDecksInSubject((prev) =>
          prev.map((d) =>
            d.deckId === selectedDeck.deckId ? { ...d, lastScore: score } : d
          )
        );
      } catch {
        // ignore
      }
    } else {
      setLearnIndex((prev) => prev + 1);
    }
  }, [selectedDeck, learnIndex, selectedChoiceIndex, correctCount, quizAnswered]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedView style={styles.center}>
          <ActivityIndicator size="large" color={Pastel.coralStrong} />
          <ThemedText style={styles.loadingText}>読み込み中…</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  // Step 3: カード/クイズ表示
  if (selectedDeck) {
    const cards = selectedDeck.cards;
    const current = cards[deckIndex];
    const isFlipped = flipped[deckIndex];
    const hasQuiz = cards.some(
      (c) => Array.isArray(c.choices) && c.choices.length >= 2 && !!c.correctAnswer
    );
    const lastScore = selectedDeck.lastScore;
    const quizCard = cards[learnIndex] ?? cards[0];
    const quizChoices = quizCard.choices ?? [];
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedView style={styles.container}>
          <View style={styles.deckHeader}>
            <TouchableOpacity onPress={goBackToDeckList} style={styles.backButton} activeOpacity={0.8}>
              <ThemedText style={styles.backButtonText}>← プリント一覧</ThemedText>
            </TouchableOpacity>
            <ThemedText style={styles.deckTitle} numberOfLines={1}>
              {selectedDeck.printTitle}
            </ThemedText>
            <ThemedText style={styles.deckMeta}>
              {deckIndex + 1} / {cards.length}
            </ThemedText>
          </View>
          {lastScore ? (
            <View style={styles.lastScoreBox}>
              <ThemedText style={styles.lastScoreText}>
                前回 {lastScore.percentage}点（{lastScore.correct}/{lastScore.total} 問 正解）
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.modeToggleRow}>
            <TouchableOpacity
              style={[styles.modeToggleButton, mode === 'browse' && styles.modeToggleButtonActive]}
              onPress={() => setMode('browse')}
              activeOpacity={0.8}
            >
              <ThemedText
                style={[styles.modeToggleText, mode === 'browse' && styles.modeToggleTextActive]}
              >
                カードめくり
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeToggleButton,
                mode === 'learn' && styles.modeToggleButtonActive,
                !hasQuiz && styles.modeToggleButtonDisabled,
              ]}
              onPress={hasQuiz ? startLearnMode : undefined}
              activeOpacity={hasQuiz ? 0.8 : 1}
            >
              <ThemedText
                style={[
                  styles.modeToggleText,
                  mode === 'learn' && styles.modeToggleTextActive,
                  !hasQuiz && styles.modeToggleTextDisabled,
                ]}
              >
                クイズ
              </ThemedText>
            </TouchableOpacity>
          </View>
          {mode === 'browse' && (
            <>
              <TouchableOpacity
                style={styles.cardTouchable}
                onPress={() => flipCard(deckIndex)}
                activeOpacity={1}
              >
                <View
                  style={[
                    styles.card,
                    { width: width - 48 },
                    isFlipped ? styles.cardBack : styles.cardFront,
                  ]}
                >
                  {!isFlipped && <ThemedText style={styles.cardIcon}>📝</ThemedText>}
                  {current.imageUri ? (
                    <CroppedImageWithRedaction
                      imageUri={current.imageUri}
                      imageRegion={current.imageRegion}
                      redaction_boxes={selectedDeck.redaction_boxes}
                      style={styles.cardImageWrap}
                    />
                  ) : null}
                  <ThemedText style={styles.cardQuestion} numberOfLines={isFlipped ? 20 : 6}>
                    {current.question}
                  </ThemedText>
                  {isFlipped ? (
                    <View style={styles.answerBox}>
                      <ThemedText style={styles.answerLabel}>答え ✓</ThemedText>
                      <ThemedText style={styles.cardAnswer}>
                        {current.answer || '（答えをメモできます）'}
                      </ThemedText>
                      {current.explanation ? (
                        <ThemedText style={styles.cardExplanation}>{current.explanation}</ThemedText>
                      ) : null}
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
            </>
          )}
          {mode === 'learn' && (
            <View style={styles.quizContainer}>
              {!hasQuiz ? (
                <ThemedText style={styles.quizNotice}>
                  この単語帳にはクイズ用の選択肢がありません。
                </ThemedText>
              ) : (
                <ScrollView
                  style={styles.quizScroll}
                  contentContainerStyle={styles.quizScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={true}
                >
                  <ThemedText style={styles.quizMeta}>
                    {learnIndex + 1} / {cards.length} 問
                  </ThemedText>
                  {quizCard.imageUri ? (
                    <CroppedImageWithRedaction
                      imageUri={quizCard.imageUri}
                      imageRegion={quizCard.imageRegion}
                      redaction_boxes={selectedDeck.redaction_boxes}
                      style={styles.cardImageWrap}
                    />
                  ) : null}
                  <ThemedText style={styles.quizQuestion}>{quizCard.question}</ThemedText>
                  <View style={styles.quizChoices}>
                    {quizChoices.map((choice, index) => {
                      const selected = selectedChoiceIndex === index;
                      const isCorrectChoice =
                        !!quizCard.correctAnswer && choice === quizCard.correctAnswer;
                      const showCorrect = quizAnswered && selected && isCorrectChoice;
                      const showIncorrect = quizAnswered && selected && !isCorrectChoice;
                      return (
                        <TouchableOpacity
                          key={index}
                          style={[
                            styles.quizChoiceButton,
                            selected && styles.quizChoiceButtonSelected,
                            showCorrect && styles.quizChoiceButtonCorrect,
                            showIncorrect && styles.quizChoiceButtonIncorrect,
                          ]}
                          onPress={() => !quizAnswered && handleChoiceSelect(index)}
                          activeOpacity={0.8}
                          disabled={quizAnswered}
                        >
                          <ThemedText
                            style={[
                              styles.quizChoiceText,
                              selected && styles.quizChoiceTextSelected,
                              showCorrect && styles.quizChoiceTextCorrect,
                              showIncorrect && styles.quizChoiceTextIncorrect,
                            ]}
                          >
                            {choice}
                            {showCorrect ? ' ✓' : showIncorrect ? ' ✗' : ''}
                          </ThemedText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {quizAnswered && (
                    <View style={styles.quizFeedbackBox}>
                      <ThemedText style={styles.quizFeedbackTitle}>
                        {quizCard.correctAnswer &&
                        selectedChoiceIndex != null &&
                        quizChoices[selectedChoiceIndex] === quizCard.correctAnswer
                          ? '正解！'
                          : '不正解'}
                      </ThemedText>
                      {quizCard.explanation ? (
                        <ThemedText style={styles.quizFeedbackExplanation}>
                          {quizCard.explanation}
                        </ThemedText>
                      ) : null}
                    </View>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.quizNextButton,
                      !quizAnswered && styles.quizNextButtonDisabled,
                    ]}
                    onPress={handleNextOrFinish}
                    activeOpacity={quizAnswered ? 0.8 : 1}
                    disabled={!quizAnswered}
                  >
                    <ThemedText style={styles.quizNextButtonText}>
                      {learnIndex === cards.length - 1 ? '結果を見る' : '次へ'}
                    </ThemedText>
                  </TouchableOpacity>
                  {isLearnFinished && (
                    <View style={styles.quizResultBox}>
                      <ThemedText style={styles.quizResultText}>
                        {cards.length}問中{correctCount}問正解（
                        {cards.length > 0 ? Math.round((correctCount / cards.length) * 100) : 0}
                        点）
                      </ThemedText>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          )}
        </ThemedView>
      </SafeAreaView>
    );
  }

  // Step 2: 科目内プリント一覧
  if (selectedSubject) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedView style={styles.container}>
          <View style={styles.deckHeader}>
            <TouchableOpacity
              onPress={goBackToSubjectList}
              style={styles.backButton}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.backButtonText}>← 科目一覧</ThemedText>
            </TouchableOpacity>
            <ThemedText style={styles.deckTitle} numberOfLines={1}>
              {selectedSubject}
            </ThemedText>
          </View>
          {loadingDecks ? (
            <ThemedView style={styles.center}>
              <ActivityIndicator size="large" color={Pastel.coralStrong} />
              <ThemedText style={styles.loadingText}>プリント一覧を読み込み中…</ThemedText>
            </ThemedView>
          ) : decksInSubject.length === 0 ? (
            <ThemedText style={styles.emptyText}>
              この科目にはまだプリントがありません。
            </ThemedText>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              {decksInSubject.map((deck) => (
                <TouchableOpacity
                  key={deck.deckId}
                  style={styles.deckCard}
                  onPress={() => openDeck(deck)}
                  onLongPress={() =>
                    deleteDeckConfirm(selectedSubject, deck.deckId, deck.printTitle)
                  }
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.deckCardTitle}>{deck.printTitle}</ThemedText>
                  <View style={styles.deckMetaRow}>
                    <ThemedText style={styles.deckCardMeta}>
                      {deck.cards.length}枚
                      {deck.lastScore
                        ? ` ・ 前回 ${deck.lastScore.percentage}点（${deck.lastScore.correct}/${deck.lastScore.total}問）`
                        : ''}
                    </ThemedText>
                    <ThemedText style={styles.deckCardDate}>
                      {formatSavedAt(deck.savedAt)}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.subjectHint}>タップで開く / 長押しで削除</ThemedText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </ThemedView>
      </SafeAreaView>
    );
  }

  // Step 1: 科目一覧
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.title}>
          単語帳
        </ThemedText>
        <ThemedText style={styles.subtitle}>
          科目を選ぶと、その中のプリント一覧が表示されます。
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
                onPress={() => openSubject(subject)}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.subjectTitle}>{subject}</ThemedText>
                <ThemedText style={styles.subjectHint}>タップでプリント一覧を表示</ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Pastel.cream },
  container: { flex: 1, backgroundColor: Pastel.cream },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { color: Pastel.coralStrong },
  title: { marginBottom: 8, color: Pastel.coralStrong, paddingHorizontal: 20 },
  subtitle: { marginBottom: 20, opacity: 0.9, color: Pastel.coralStrong, paddingHorizontal: 20 },
  emptyText: {
    paddingHorizontal: 20,
    color: Pastel.coralStrong,
    lineHeight: 22,
    textAlign: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  subjectCard: {
    backgroundColor: Pastel.cardFront,
    padding: 16,
    borderRadius: Pastel.borderRadius,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Pastel.coral,
    ...Pastel.shadowStyle,
  },
  subjectTitle: { fontSize: 18, fontWeight: '600', color: Pastel.coralStrong },
  subjectHint: { fontSize: 12, color: Pastel.coralStrong, marginTop: 4 },
  deckCard: {
    backgroundColor: Pastel.cardFront,
    padding: 16,
    borderRadius: Pastel.borderRadius,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Pastel.coral,
    ...Pastel.shadowStyle,
  },
  deckCardTitle: { fontSize: 16, fontWeight: '600', color: Pastel.coralStrong },
  deckMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  deckCardMeta: { fontSize: 13, color: Pastel.coralStrong, flexShrink: 1 },
  deckCardDate: { fontSize: 12, color: '#777' },
  deckHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Pastel.shadow,
  },
  backButton: { paddingVertical: 8, paddingRight: 12 },
  backButtonText: { color: Pastel.coralStrong, fontSize: 16 },
  deckTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: Pastel.coralStrong },
  deckMeta: { fontSize: 14, color: Pastel.coralStrong },
  lastScoreBox: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: Pastel.pink,
  },
  lastScoreText: { fontSize: 12, color: Pastel.coralStrong },
  modeToggleRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  modeToggleButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Pastel.coral,
    alignItems: 'center',
  },
  modeToggleButtonActive: { backgroundColor: Pastel.pink },
  modeToggleButtonDisabled: { opacity: 0.4 },
  modeToggleText: { fontSize: 13, color: Pastel.coralStrong },
  modeToggleTextActive: { fontWeight: '600' },
  modeToggleTextDisabled: { color: '#9e9e9e' },
  cardTouchable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: Pastel.borderRadius,
    padding: 24,
    minHeight: 280,
    borderWidth: 1,
    ...Pastel.shadowStyle,
  },
  cardFront: {
    backgroundColor: Pastel.cardFront,
    borderColor: Pastel.coral,
  },
  cardBack: {
    backgroundColor: Pastel.cardBack,
    borderColor: Pastel.orange,
  },
  cardIcon: { fontSize: 20, marginBottom: 8 },
  cardImageWrap: {
    width: '100%',
    height: 120,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Pastel.creamDark,
  },
  cardImage: { width: '100%', height: '100%' },
  cardQuestion: { fontSize: 16, lineHeight: 24, color: '#333' },
  tapHint: { marginTop: 16, fontSize: 13, color: Pastel.coralStrong },
  answerBox: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Pastel.coral,
  },
  answerLabel: { fontSize: 12, color: Pastel.coralStrong, marginBottom: 4 },
  cardAnswer: { fontSize: 15, lineHeight: 22, color: '#555' },
  cardExplanation: {
    fontSize: 13,
    lineHeight: 20,
    color: '#666',
    marginTop: 8,
    fontStyle: 'italic',
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
    borderRadius: Pastel.borderRadiusButton,
    backgroundColor: Pastel.pink,
  },
  navButtonText: { color: Pastel.coralStrong, fontSize: 16, fontWeight: '600' },
  quizContainer: { flex: 1, paddingHorizontal: 20, paddingVertical: 16 },
  quizScroll: { flex: 1 },
  quizScrollContent: { flexGrow: 1, paddingBottom: 32 },
  quizNotice: { fontSize: 13, color: Pastel.coralStrong, lineHeight: 20 },
  quizMeta: { fontSize: 13, color: Pastel.coralStrong, marginBottom: 8 },
  quizQuestion: { fontSize: 16, lineHeight: 24, color: '#333', marginTop: 8, marginBottom: 12 },
  quizChoices: { gap: 8, marginBottom: 16 },
  quizChoiceButton: {
    borderRadius: Pastel.borderRadiusButton,
    borderWidth: 1,
    borderColor: Pastel.coral,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Pastel.cardFront,
  },
  quizChoiceButtonSelected: {
    backgroundColor: Pastel.pink,
    borderColor: Pastel.coralStrong,
  },
  quizChoiceButtonCorrect: {
    backgroundColor: 'rgba(124, 179, 66, 0.2)',
    borderColor: Pastel.success,
  },
  quizChoiceButtonIncorrect: {
    backgroundColor: 'rgba(199, 92, 92, 0.15)',
    borderColor: Pastel.error,
  },
  quizChoiceText: { fontSize: 15, color: Pastel.coralStrong },
  quizChoiceTextSelected: { fontWeight: '600' },
  quizChoiceTextCorrect: { color: Pastel.success },
  quizChoiceTextIncorrect: { color: Pastel.error },
  quizFeedbackBox: {
    marginTop: 12,
    marginBottom: 8,
    padding: 14,
    borderRadius: Pastel.borderRadiusButton,
    backgroundColor: Pastel.pink,
    borderWidth: 1,
    borderColor: Pastel.coral,
  },
  quizFeedbackTitle: { fontSize: 16, fontWeight: '700', color: Pastel.coralStrong, marginBottom: 6 },
  quizFeedbackExplanation: { fontSize: 14, lineHeight: 22, color: '#555' },
  quizNextButton: {
    borderRadius: Pastel.borderRadius,
    backgroundColor: Pastel.coralStrong,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  quizNextButtonDisabled: { backgroundColor: Pastel.creamDark, opacity: 0.8 },
  quizNextButtonText: { fontSize: 15, color: '#fff', fontWeight: '600' },
  quizResultBox: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Pastel.borderRadiusButton,
    backgroundColor: Pastel.pink,
  },
  quizResultText: { fontSize: 14, color: Pastel.coralStrong },
});
