# 本番ビルド前の実機テスト手順と報告項目

---

## 最短手順: TestFlight・Androidクローズドテストで本番広告を確認する

本番と同じ広告（バナー・インタースティシャル）を実機で確認したいときの最小手順です。  
**事前に `lib/ads.ts` の `USE_TEST_ADS = false` にしておく**（本番広告でビルド）。

### 共通準備（1回だけ）

```bash
npm install -g eas-cli
eas login
```

プロジェクトルートで実行。

---

### iOS（TestFlight）

1. **ビルド（本番プロファイルでOK。プレビューでも広告は同じ）**
   ```bash
   eas build --profile production --platform ios
   ```
   または内部配布だけでよい場合:
   ```bash
   eas build --profile preview --platform ios
   ```

2. **ビルド完了後、Expo ダッシュボードのビルド詳細から IPA をダウンロード。**

3. **TestFlight に提出**
   ```bash
   eas submit --platform ios --latest
   ```
   （初回は Apple ID・App 固有パスワード・App Store Connect のアプリ選択を聞かれる）

4. **TestFlight の「外部テスト」または「内部テスト」でテスト者を追加し、メールで招待。テスト者が TestFlight アプリからインストール。**

5. **実機で確認**: 起動 → 広告が表示されるか（バナー＋タブ遷移時などのインタースティシャル）を確認。

---

### Android（クローズドテスト / 内部配布）

1. **ビルド（本番プロファイルでストア提出用、または preview でAPKだけ）**
   - ストアのクローズドテストに出す場合:
     ```bash
     eas build --profile production --platform android
     ```
   - APK を直接配布するだけの場合:
     ```bash
     eas build --profile preview --platform android
     ```

2. **ビルド完了後**
   - **production**: Expo ダッシュボード → ビルド詳細 → 「Submit to Google Play」または手動で AAB を [Play Console](https://play.google.com/console) の「リリース」→「テスト」→「クローズドテスト」にアップロード。
   - **preview**: ダッシュボードから APK をダウンロードし、実機に転送してインストール。

3. **クローズドテストの場合**: Play Console でテスターリスト（メール）を登録し、招待。テスターは Play ストアから「参加」してインストール。

4. **実機で確認**: 起動 → バナー・インタースティシャルが表示されるか確認。

---

### コマンド一覧（コピペ用）

| 目的 | コマンド |
|------|----------|
| iOS ビルド（TestFlight 提出用） | `eas build --profile production --platform ios` |
| iOS を TestFlight に提出 | `eas submit --platform ios --latest` |
| Android ビルド（ストア・クローズド用） | `eas build --profile production --platform android` |
| Android ビルド（APK のみ・実機確認用） | `eas build --profile preview --platform android` |

広告はビルド時に `USE_TEST_ADS` の値が埋め込まれるため、**本番広告を試す場合はビルド前に `USE_TEST_ADS = false` にしておく**必要があります。

---

## 1. 本番ビルドするまでの実機テスト手順（詳細）

### 前提

- Node.js と npm が入っていること
- [Expo](https://expo.dev) アカウントでログイン済みであること
- 実機（Android または iPhone）を用意し、USB 接続または同一 Wi‑Fi でアクセスできること

### 手順

1. **EAS CLI のインストール（未導入の場合）**
   ```bash
   npm install -g eas-cli
   ```

2. **Expo にログイン**
   ```bash
   eas login
   ```

3. **プレビュービルド（実機テスト用）**
   - Android:
     ```bash
     eas build --profile preview --platform android
     ```
   - iOS（Apple Developer が必要）:
     ```bash
     eas build --profile preview --platform ios
     ```
   - ビルド完了後、Expo のダッシュロードページのリンクから APK（Android）または IPA（iOS）をダウンロードする。

4. **実機へインストール**
   - **Android**: ダウンロードした APK を端末に転送し、ファイルからインストール（「提供元不明のアプリ」を許可する必要がある場合あり）。
   - **iOS**: TestFlight を使う場合は `eas submit` でアップロードし、TestFlight からインストール。社内のみの場合はダウンロードした IPA を Apple Configurator 等でインストールする方法もある。

5. **本番と同じ条件で試す場合**
   - 広告は `lib/ads.ts` の `USE_TEST_ADS = false` の状態でビルドすると本番広告になる（プレビュービルドでも同じ設定が使われる）。
   - 本番用ビルドを作る場合は:
     ```bash
     eas build --profile production --platform android
     eas build --profile production --platform ios
     ```
     必要に応じて `eas submit --platform android` / `--platform ios` でストア提出用にアップロードする。

---

## 2. テスト時に確認すること（チェックリスト）

テストした内容を報告するときは、次の項目について「OK / 要確認 / 不具合」と、あれば現象・端末・OS を書くと伝わりやすいです。

### 共通

- [ ] アプリが起動し、タブ（ホーム・お知らせ・フラッシュカード・その他）が問題なく切り替わる
- [ ] カメラ・アルバムから画像を選べる
- [ ] お知らせ解析が完了し、予定一覧が表示される
- [ ] 日時・色・通知の編集ができる
- [ ] カレンダー登録が成功し、成功メッセージが表示される
- [ ] フラッシュカードの保存・復習・PDF 出力が想定どおり動く
- [ ] 広告（バナー・インタースティシャル）が表示される／非表示設定が効く（プレミアム時など）
- [ ] クラッシュや強制終了がない

### Android のみ

- [ ] カレンダー登録後、成功ダイアログに「Googleカレンダー・ウェブへの反映に数分かかることがあります」の注意が表示される
- [ ] 数分以内に Google カレンダーアプリまたは calendar.google.com に予定が反映される（遅れは仕様の範囲）
- [ ] 「すべてのGoogleアカウント」を選んだ場合、複数アカウントのカレンダーに登録される

### iOS のみ

- [ ] 登録先「iOS標準」「Google」「両方」「すべてのGoogleアカウント」のいずれも期待どおり登録される
- [ ] 色選択が Google カレンダーに反映される（選択時）

---

## 3. テスト結果の報告テンプレート

以下のように書いて報告すると、原因の切り分けがしやすくなります。

```
【テスト環境】
- 端末: （例: Pixel 7 / iPhone 14）
- OS: （例: Android 14 / iOS 17.2）
- ビルド: （例: preview 2025-03-11 / production 1.0.1）

【結果サマリ】
- 共通: OK / 要確認 / 不具合
- カレンダー登録: OK / 要確認 / 不具合
- 広告: OK / 要確認 / 非表示のまま など

【不具合・要確認の詳細】
（あれば）
- 現象: （何をしたらどうなったか）
- 再現手順: （できるだけ具体的に）
- ログ: （クラッシュやエラーが出た場合、可能ならコンソールやクラッシュレポートの抜粋）
```

---

## 4. Android のカレンダー反映が遅いことについて

- Android では、アプリが予定を「端末のカレンダー」に書き込んだあと、**OS の同期機能**が Google のサーバーとバックグラウンドで同期します。
- この同期のタイミングは OS 任せのため、**数分遅れることがあります**（アプリ側で即時同期を強制する標準 API はありません）。
- そのため、登録成功時に「反映に数分かかることがあります」と案内するようにしています。iPhone では OS の扱いの違いで即時反映されやすいです。
- テスト時は「登録成功メッセージが出たか」「数分待ったあとに Google カレンダーに表示されたか」を確認するとよいです。
