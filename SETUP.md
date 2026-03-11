# スコア予想サイト セットアップガイド

## ファイル構成

```
match-score-prediction/
├── index.html          # メインページ
├── style.css           # スタイル
├── app.js              # アプリロジック
├── config.js           # ★ 設定ファイル（要編集）
├── supabase-schema.sql # DBスキーマ
└── SETUP.md            # このファイル
```

---

## ステップ 1：Supabase のセットアップ

### 1-1. アカウント作成 & プロジェクト作成

1. [https://supabase.com](https://supabase.com) にアクセス
2. 「Start your project」でアカウント作成（GitHub連携が簡単）
3. ダッシュボードから **「New project」** をクリック
4. 以下を入力：
   - **Name**：任意（例：`match-score-prediction`）
   - **Database Password**：任意のパスワード（メモしておく）
   - **Region**：`Northeast Asia (Tokyo)` を選択
5. 「Create new project」をクリック（数分かかります）

---

### 1-2. データベースのテーブル作成

1. 左サイドメニューの **「SQL Editor」** をクリック
2. 右上の **「New query」** をクリック
3. `supabase-schema.sql` の内容を**全てコピー**してエディタに貼り付け
4. 右上の **「Run」** ボタンをクリック
5. 「Success」と表示されれば完了

---

### 1-3. Realtime（リアルタイム更新）の有効化

1. 左サイドメニューの **「Database」** → **「Replication」** をクリック
2. **「supabase_realtime」** の横の `0 tables` をクリック
3. `matches` と `predictions` の両方をトグルで**ON**にする

---

### 1-4. API キーの取得

1. 左サイドメニューの **「Settings」** → **「API」** をクリック
2. 以下をメモ：
   - **Project URL**（例：`https://abcdefghijk.supabase.co`）
   - **Project API keys** の `anon` `public`（長い文字列）

---

## ステップ 2：config.js を編集

`config.js` を開いて、取得した値を設定します：

```javascript
// Supabase の設定
const SUPABASE_URL = 'https://あなたのURL.supabase.co';  // ← 貼り付け
const SUPABASE_ANON_KEY = 'eyJhbGciOi...';               // ← 貼り付け

// 管理者パスワード（必ず変更してください！）
const ADMIN_PASSWORD = 'your-password-here';
```

---

## ステップ 3：Netlify にデプロイ

### 方法A：ドラッグ&ドロップ（最も簡単）

1. [https://netlify.com](https://netlify.com) にアクセスしてアカウント作成
2. ダッシュボードの **「Add new site」** → **「Deploy manually」**
3. このプロジェクトフォルダ全体をブラウザにドラッグ&ドロップ
4. 数秒でデプロイ完了！URLが発行されます

### 方法B：GitHub 連携（自動デプロイ）

1. プロジェクトを GitHub にプッシュ
2. Netlify で **「Add new site」** → **「Import an existing project」**
3. GitHub を選択してリポジトリを選ぶ
4. **Build settings** はそのまま（静的サイトなので不要）
5. **「Deploy site」** をクリック
6. 以後、GitHub に push するたびに自動デプロイされる

---

## 使い方

### 一般ユーザー

- サイトを開いて試合カードの **「スコアを予想する」** をクリック
- 名前とスコアを入力して登録（名前はブラウザに保存されます）
- 自分の予想には「あなた」タグが付き、✏️ ボタンで編集可能
- リアルタイムで他のユーザーの予想も表示されます

### 管理者

1. 右上の **「管理者ログイン」** をクリック
2. `config.js` に設定したパスワードを入力
3. 以下の操作が可能になります：

| 操作 | ボタン |
|------|--------|
| 試合の追加 | ページ上部の「＋ 試合を追加」 |
| 試合の編集 | 試合カード右上の ✏️ |
| スコア入力 | 試合カード右上の ⚽ |
| 締め切り設定 | 試合カード右上の ⏰ |
| 試合の削除 | 試合カード右上の 🗑️ |

### スコアの見方

| 表示 | 意味 |
|------|------|
| 👑（ゴールド枠） | 確定スコアと一致！おめでとう！ |
| 😢（薄表示） | 途中スコアで外れ確定 |
| ❌（薄表示） | 確定スコアと不一致 |

---

## 注意事項

- **管理者パスワードは必ず変更してください**（`config.js` の `ADMIN_PASSWORD`）
- Supabase の anon キーはクライアントに公開されますが、読み書き権限はRLSで制御されています
- 同じ名前のユーザーは同じ人として扱われます（予想は上書き更新されます）
- 試合のチーム名を後から編集しても、既存の予想は消えません

---

## トラブルシューティング

**「データの読み込みに失敗しました」と表示される**
→ `config.js` の URL と API キーが正しいか確認してください

**リアルタイム更新が効かない**
→ Supabase ダッシュボードの Database → Replication で `matches` と `predictions` が ON になっているか確認

**予想が登録できない**
→ 締め切り時間が過ぎていないか確認。管理者で締め切り時間を延長してください
