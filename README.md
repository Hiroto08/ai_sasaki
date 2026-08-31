# AI社長と遊ぶ（佐々木社長AIパロディ / 非公式・エンタメ用モック）

三井住友カード株式会社 代表取締役社長・佐々木丈也氏の**公開情報のみ**から構築した、
エンタメ用のアバター付きAI社長パロディアプリ。「陽気なキャッシュレス伝道師」キャラの
AI社長と、おみくじ・診断・クイズ・雑談で遊べる。

> 🎭 **重要な注意**
> 本アプリはエンタメ・パロディ用途の非公式ファンコンテンツ（AIによる創作）です。
> 回答は佐々木丈也氏本人の発言・見解ではなく、本人および三井住友カード株式会社の
> 監修・承認を受けていません。本人同意が得られていないため、**実在の容姿・音声の再現
> （顔写真アバター・音声クローン）は意図的に行っていません**（イラストアバター +
> 端末標準の合成音声のみ）。本人への敬意を欠く内容を生成しないガードレールを設けています。
> 社外公開・商用利用は想定していません。

## 遊べる機能

| 機能 | 使い方 |
|---|---|
| 🔑 合言葉で入場 | QRでアクセス → 合言葉を入力しないとチャットできない（イベント参加者限定） |
| 🌶️ 辛口モードトグル | スイッチひとつで「愛のあるダメ出しモード」に切替。口癖・口調が変わる |
| 🎋 社長おみくじ | 「おみくじ」→ 運勢 + キャッシュレス格言 + ラッキー決済手段 |
| 💳 キャッシュレス度診断 | 「診断して」→ キャッシュレス度○○% と称号を判定 |
| 💡 社長クイズ | 「クイズ出して」→ 決済・会社にまつわる三択クイズ |
| 🍜 なんでも相談 | ランチ選び・恋愛相談・やる気が出ない…なんでもOK。ただし最後はだいたいキャッシュレスの話になる |

イベント運用（同時200名・1日限定）を想定し、1人あたり発話上限（既定30回）と毎分制限つき。

**📗 イベントで公開する手順（Google Cloud初心者向け）→ [docs/DEPLOY_GUIDE.md](docs/DEPLOY_GUIDE.md)**
### 📚 イベント用ドキュメント（読む順）

| # | ドキュメント | 何が書いてあるか |
|---|---|---|
| 0 | [**docs/SCHEDULE.md**](docs/SCHEDULE.md) | **9/1本番の逆算スケジュール**。いつ何をやるか（日付入り） |
| 0.5 | [**docs/SURVEY.md**](docs/SURVEY.md) | **周辺アンケート設計**。AIの解像度を上げる最重要工程（今日から着手可） |
| 0.6 | [**docs/SURVEY_RESULT.md**](docs/SURVEY_RESULT.md) | ★**アンケート集計結果とAIへの反映案**（25名・340件）。**現ペルソナとの乖離を含む** |
| 1 | [**docs/EVENT_RUNDOWN.md**](docs/EVENT_RUNDOWN.md) | 15分の構成・費用・全体像 |
| 2 | [**docs/BUILD_GUIDE.md**](docs/BUILD_GUIDE.md) | **構築手順書**。各作業を1手ずつ |
| 3 | [**docs/SERVICE_SETUP.md**](docs/SERVICE_SETUP.md) | HeyGen／ElevenLabs／seedance の画面操作 |
| 3.4 | [**docs/AVATAR_LOOK.md**](docs/AVATAR_LOOK.md) | **アバターのルック設計と背景生成プロンプト**／**#3クイズのA/Bスライド設計** |
| 3.5 | [**docs/OPENING_VIDEO.md**](docs/OPENING_VIDEO.md) | **オープニング動画のシンクロシート**（36.18秒・秒数確定済み）／**楽曲は権利フリー・生成音源を動画に焼き込む** |
| 3.6 | [**docs/storyboard.html**](docs/storyboard.html) | **絵コンテ**（7カットの画・秒数・演出メモ）。ブラウザで開く／印刷可。**8/20に本人へ見せる用** |
| 4 | [**docs/DEPLOY_GUIDE.md**](docs/DEPLOY_GUIDE.md) | アプリをCloud Runで公開する手順 |
| 5 | [**docs/MC_SCRIPT.md**](docs/MC_SCRIPT.md) | **当日の実行台本**。開演60分前〜撤収まで |
| 6 | [**docs/qr_sheet.html**](docs/qr_sheet.html) | ★**入場QR**。#5の投影スライドと、A4に4枚並ぶ卓上カード（ブラウザで開いて印刷） |
| 7 | [**docs/quiz_slides.html**](docs/quiz_slides.html) | ★**#3クイズの進行スライド**（5問×4枚）。設問→A/B→動画キュー→正解。**先頭のQUIZを書き換えるだけで差し替え可** |
| 7.5 | [**docs/quiz_pool.html**](docs/quiz_pool.html) | ★**クイズ設問プール100問**とAI側の回答。分類・キーワードで絞り込んで5問選ぶ（元データは `data/content/quiz_pool.json`） |

会場のスクリーン投影には **`/stage.html`**（ステージモード）を使う。司会がボタンで進行でき、
大文字表示・辛口モードの赤い覇気演出・`H`キーで操作パネル非表示に対応。

## クイックスタート（完全ローカル動作）

必要なのは Node.js 18+ だけ。`npm install` 不要（依存パッケージゼロ）。

```bash
git clone https://github.com/Hiroto08/ai_sasaki.git
cd ai_sasaki
npm start        # または node server.js
```

→ http://localhost:3000 を開く。この時点では**デモモード**（APIキー不要・
定型応答・ネット接続不要）で動く。

### AI応答モードにする（Gemini APIを繋ぐ）

```bash
cp .env.example .env
# .env を開いて GEMINI_API_KEY=... を設定
npm start
```

または環境変数で直接 `GEMINI_API_KEY=... npm start`。
APIキーは [Google AI Studio](https://aistudio.google.com/apikey) で取得できる。
起動時のコンソールに現在のモード（デモ / Gemini API）が表示される。
データ・設定・UIはすべてローカル完結で、外部に接続するのはAI応答モード時の
Gemini API（`generativelanguage.googleapis.com`）のみ。

### .env の設定項目

| 変数 | 内容 | 既定値 |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini APIキー。未設定ならデモモード（`GOOGLE_API_KEY` でも可） | （なし） |
| `MODEL` | 使用モデル。**2.5系でも3系でも動く**（下記） | `gemini-2.5-flash` |
| `MAX_OUTPUT_TOKENS` | 1回の出力上限。通常は触らない | 2.5系 `512` / 3系 `2048` |
| `PORT` | 待ち受けポート | `3000` |
| `PASSPHRASE` | 入場用の合言葉 | `おめでとう` |
| `SECRET` | トークン署名鍵（省略時は起動ごとにランダム） | （自動生成） |
| `MAX_TURNS` | 1人あたり発話上限 | `30` |
| `MAX_PER_MIN` | 1人あたり毎分発話上限 | `6` |

### モデルの切り替え（世代差はサーバー側で吸収済み）

`MODEL` を変えるだけで世代を移行できる。**再デプロイ不要**（環境変数の更新だけで数十秒）。

```bash
gcloud run services update ai-shacho --region asia-northeast1 \
  --update-env-vars "MODEL=gemini-3.7-flash"
```

> 🚨 **「思考」の指定方法が世代で違う。**
> 2.5系は `thinkingConfig.thinkingBudget`（`0` で無効化できる）、
> 3系は `thinkingConfig.thinkingLevel`（`LOW`/`HIGH` など。0にはできない）。
> **両方を同時に送るとエラーになる。**
> `server.js` がモデル名から世代を判定して片方だけ送るので、`MODEL` の差し替えだけで動く。
>
> 思考トークンも出力枠を消費するため、3系では出力上限を自動で広げている
> （狭いままだと思考で枠を使い切り、**本文が空で返る**）。
> 起動ログに `思考設定: ...` として実際の設定が出るので、そこで確認できる。

## 口癖のパラメーター設定（data/config.json）

口調・口癖は `data/config.json` の `speechStyle` で管理する。**編集して保存するだけで
次の応答から反映される（サーバー再起動不要）**。本人の動画・音源から口癖を抽出でき次第、
ここに追記していく運用。

```jsonc
"speechStyle": {
  "firstPerson": "私",              // 一人称
  "customerWord": "お客様",          // 顧客の呼び方
  "catchphrases": ["気が利くね！"],  // 口癖・キーフレーズ（会話に織り交ぜる）
  "sentenceEndings": [],            // 特徴的な語尾（例：「〜だね」「〜なんですよ」）
  "fillerPhrases": [],              // つなぎ言葉・話し始めの癖
  "praiseStyle": "",                // 褒め方の癖
  "scoldStyle": "",                 // 注意・指摘の仕方
  "ngWords": [],                    // 本人が使わない言葉
  "notes": "..."                    // 話し方の補足（自由記述）
}
```

空欄（未設定）の項目はAIが勝手に創作しない仕様。パラメーターはAI応答モードの
システムプロンプトに反映される。

## 写真アバターの差し込み（本人許諾後）

本人の許諾が得られるまではイラストアバターで動作する。許諾取得後は：

1. `public/avatar.png` に写真（PNG形式、推奨 縦長 200×230px 以上）を置く
2. `data/config.json` の `avatar.consentConfirmed` を `true` にする（**設定済み**）

この2つが揃ったときだけ写真に切り替わる（どちらか欠けるとイラストのまま）。
写真は `.gitignore` 済みでリポジトリにはコミットされない。発話時は写真が軽く動く。

> 🚨 **Cloud Run にデプロイする場合の注意。**
> `.gitignore` が `public/*.png` を除外しているため、**`.gcloudignore` が無いと
> gcloud がそれを代用し、写真がアップロードから抜け落ちます**（エラーは出ません）。
> リポジトリに `.gcloudignore` を用意済みです。手順は
> [`docs/DEPLOY_GUIDE.md` STEP 4.5](docs/DEPLOY_GUIDE.md) を参照。

## 構成

| ファイル | 内容 |
|---|---|
| `server.js` | 依存ゼロのNodeサーバー。`/api/chat` でGemini API or デモ応答 |
| `public/index.html` | チャットUI + イラストアバター（まばたき・口パク）+ 読み上げ |
| `public/stage.html` | **ステージモード（大画面投影用）**。司会が操作、200人の会場向け大文字表示 |
| `public/qa.html` | **フリー質問オペレーター卓**。回答生成→音声再生をワンクリック（#4用） |
| `data/content/qa_presets.json` | **想定質問と確認済み回答**（answerを埋めると本番は即再生） |
| `data/content/stage_presets.json` | **ステージ進行ボタンの台本**（label/prompt を編集して差し替え可） |
| `data/content/stage_script.json` | **事前確認済みの回答（台本モード）**。本番はAIを呼ばずこれを再生＝失敗しない |
| （API）`/api/memories` `/api/finale` | **会場からの「思い出」投稿と、それを織り込んだフィナーレ生成** |
| `data/config.json` | **口癖・口調・アバター写真のパラメーター設定**（編集即反映） |
| `data/modes/normal.json` `spicy.json` | **通常/辛口モードの口調定義**（トグルで差し替わる部分） |
| `data/content/*.json` | **おみくじ・クイズ・診断・挨拶・定型応答**（配列追記で増やせる） |
| `data/persona.md` | ペルソナ定義（口調・価値観・ガードレール）＝システムプロンプト |
| `data/knowledge.md` | 公開情報ナレッジベース（出典付き） |
| `Dockerfile` | Cloud Runデプロイ用（依存ゼロのまま） |
| `scripts/loadtest.js` | 200人同時の負荷テストスクリプト |
| `assets/README.md` | **制作素材の置き場所**（参照画像・生成動画・本人素材・完成品）。中身はコミットしない |
| `docs/DEPLOY_GUIDE.md` | **Google Cloud初心者向けデプロイ手順書** |
| `docs/APP_DESIGN.md` | **イベント版 要件定義・設計書**（QR入場・合言葉・辛口モード・無料枠構成） |
| `docs/PLAN.md` | 構築計画書（事例リサーチ・アーキテクチャ・ロードマップ） |
| `docs/PERSONA_RESEARCH.md` | 佐々木氏の公開情報リサーチまとめと法的留意点 |

## 仕組み

```
ユーザー質問
  → server.js /api/chat
  → システムプロンプト（persona.md + knowledge.md + 会話状態）+ 会話履歴 を Gemini API へ
     ※会話状態＝初対面か会話中か／直前の書き出し／直近で使った持ちネタ を毎回計算して
       「同じ入り方・同じネタを繰り返すな」と指示（AIらしさの最大要因を潰す）
  → 「公開発言に基づく社長らしい回答」を生成（未公開情報はガードレールで回答拒否）
  → フロントでアバターが口パク + 任意で汎用TTS読み上げ
```

APIキー未設定時は、公開発言を元にした定型応答（キーワードマッチ）のデモモードで動作。

## 今後の拡張（本人・会社の許諾が得られた場合のみ）

- 実際の顔・声を使ったアバター（HeyGen等）・音声クローン（ElevenLabs等）
- 社内データ（講話・社内報）を加えたRAG構築
- 詳細は [docs/PLAN.md](docs/PLAN.md) を参照
