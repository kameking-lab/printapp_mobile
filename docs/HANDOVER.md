# プロジェクト引き継ぎ書（PrintApp Mobile）

最終更新: 2026-03-11

## 1. 環境構築手順（ローカル / 別PC）

1. Node.js / npm をインストール（推奨: LTS）。
2. 依存関係をインストール。
   - `npm install`
3. Expo / EAS にログイン。
   - `npx expo login`
   - `eas login`
4. 開発起動。
   - `npx expo start`

### `.env` の重要注意

- `.env` は Git 管理外（`.gitignore` で除外）です。別PCでは手動作成が必要です。
- 最低限、以下の環境変数を設定してください。
  - `EXPO_PUBLIC_GEMINI_API_KEY`
  - `EXPO_PUBLIC_PRIVACY_POLICY_URL`
  - `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS`
  - `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB`（推奨）
  - `EXPO_PUBLIC_EXPO_PROJECT_FULL_NAME`（例: `@kenshi.ycc/printapp_mobile`）
- `EXPO_PUBLIC_EXPO_PROJECT_FULL_NAME` は Android で Google OAuth の Expo Auth Proxy URL を確実に組み立てるために重要です。

## 2. Googleカレンダー連携（OAuth）仕様

### 方針

- `expo-auth-session` で Google OAuth を実行。
- Android は Google 仕様に合わせて **Web Client ID** を利用。
- redirect は Expo Auth Proxy（`https://auth.expo.io/...`）経由。

### 実装ポイント

- 実装ファイル: `lib/google-calendar-api.ts`, `app/(tabs)/index.tsx`
- Client ID:
  - iOS: `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS`
  - Android: `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB`（未設定時はコード側フォールバックあり）
- Proxy redirect URI:
  - `https://auth.expo.io/@owner/slug` 形式を利用
  - 生成元は次の優先順
    1. `EXPO_PUBLIC_EXPO_PROJECT_FULL_NAME`
    2. `Constants.expoConfig.originalFullName`
    3. `Constants.expoConfig.owner + slug`

### Google Cloud Console 側の設定

- OAuth クライアント種別は Android 用ではなく **ウェブアプリケーション**（Android では Web Client ID を使用）。
- 「承認済みのリダイレクト URI」に以下を登録:
  - `https://auth.expo.io/@あなたのExpoユーザー名/printapp_mobile`

### Android クラッシュ回避仕様（重要）

- `getGoogleAuthSessionProxyRedirectUri` で必須値が取得できない場合でも、**トップレベルで throw しない**。
- 例外ではなく `console.error` にフォールバックし、`undefined` を返して UI レンダリングを継続。
- これにより、起動時クラッシュ（即死）を回避し、影響範囲を Google ログイン機能に限定。

## 3. ストアレビュー機能（In-App Review）

- ライブラリ: `expo-store-review`
- 実装ファイル: `lib/store-review-milestone.ts`
- 成功体験（解析完了・PDF生成完了など）を `AsyncStorage` に累積保存。
  - キー: `@printapp/success_milestone_count`
- カウントが **5 の倍数**（5, 10, 15, ...）になったときのみ
  - `StoreReview.isAvailableAsync()` を確認
  - `StoreReview.requestReview()` を実行
- 評価済み判定や表示制御は OS 側仕様に委任（アプリ側で判定しない）。

## 4. ビルド & リリース手順

### Android（本番）

- `eas build --platform android --profile production`

### iOS（本番 + 自動提出）

- `eas build --platform ios --auto-submit`

### バージョンバンプ規則

App Store / Play Store 提出前に、`app.json` を必ず更新:

- `expo.version` を +1（例: `1.0.3` -> `1.0.4`）
- `ios.buildNumber` を +1（文字列）
- `android.versionCode` を +1（数値）

同一バージョン再提出は拒否されるため、毎回インクリメント必須。

## 5. 最近の重要修正（要点）

- ダークモード時のテキスト視認性を改善（文字色・コントラスト調整）。
- PDF 生成時に白紙ページが出る不具合を修正（HTML/CSS レイアウト調整）。
- Google OAuth（Android）での起動時クラッシュ回避を実装（throw 廃止、フォールバック化）。
- In-App Review（`expo-store-review`）を導入し、成功体験の 5 回ごとにレビューリクエスト。

## 6. 運用上の注意

- `.env`、認証情報、秘密鍵は絶対にコミットしない。
- 共有可能なのは `.env.example` のみ（実値は入れない）。
- リリース前に `git status` で機密ファイル混入がないことを確認する。
