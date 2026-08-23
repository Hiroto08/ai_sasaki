# デプロイ手順書（Google Cloud初心者向け）

AI社長アプリをGoogle Cloud Runで公開し、イベントで使えるようにするまでの全手順です。
**プログラミングやGoogle Cloudの経験がなくても、この順番にコピペしていけば完了します。**

- 所要時間：初回 約60分（アカウント作成含む）／2回目以降 約10分
- 費用：ホスティングは無料枠内（0円）。Gemini API利用料のみ実費（目安：数百〜1,000円/イベント）

---

## 全体の流れ

```
STEP 1  Gemini APIキーを取得（5分）
STEP 2  Google Cloudの準備（アカウント・プロジェクト・課金）（15分）
STEP 3  Cloud Shellでアプリをデプロイ（15分）
STEP 4  動作確認（5分）
STEP 5  QRコードを作る（5分）
STEP 6  予算アラートを設定（5分）
STEP 7  イベント当日の朝にやること（5分）
STEP 8  イベント終了後の片付け（5分）
```

---

## STEP 1：Gemini APIキーを取得する

1. ブラウザで **https://aistudio.google.com/apikey** を開く（Googleアカウントでログイン）
2. 「**APIキーを作成**」ボタンを押す
3. 表示された `AIza...` で始まる文字列が**APIキー**。メモ帳などに控える

> ⚠️ **APIキーは合鍵と同じ**です。人に見せない・チャットやメールに貼らない・
> このリポジトリにコミットしないでください。

> 💡 無料枠のAPIキーはリクエスト数制限が小さく（毎分10回程度）、200人イベントでは
> 足りません。STEP 2で課金を有効にすると、同じキーが自動的に有料枠（毎分1,000回）に
> 引き上がります。それでも今回の規模なら実費は数百〜1,000円程度です。

## STEP 2：Google Cloudの準備

### 2-1. アカウントとプロジェクト作成

1. **https://console.cloud.google.com/** を開き、Googleアカウントでログイン
2. 初回は利用規約に同意（無料トライアル$300クレジットの案内が出たら受けてOK。今回の費用はほぼこれで賄える）
3. 画面上部のプロジェクト名（「My First Project」など）をクリック →「**新しいプロジェクト**」
4. プロジェクト名：`ai-shacho`（任意）
5. 🚨 ★**「作成」を押す前に、その下の「プロジェクト ID」を見てください**（下記 2-1-2）
6. 「作成」→ 画面上部のプロジェクト選択で `ai-shacho` を選んでおく

### 2-1-2. 🚨 ★プロジェクト「名」と「ID」は別物です

**STEP 3 のコマンドで使うのは、名前ではなく ID のほうです。**

```
プロジェクト名    ai-shacho            ← 表示用。あとから変更できる
プロジェクト ID   ai-shacho-473812     ← ★これを使う。作成後は変更できない
```

**名前に `ai-shacho` と入れても、IDが `ai-shacho` になるとは限りません。**
IDは**世界中で一意**である必要があるため、すでに使われていると
`ai-shacho-473812` のように**自動で数字が付きます**。

> ★**作成画面で名前を入力すると、すぐ下に「プロジェクト ID: ...」と小さく表示され、
> その横の「編集」で好きなIDに変えられます。ここが唯一の変更チャンスです。**
> 一度「作成」を押すと、**IDは二度と変えられません。**

**控え忘れた場合の探し方**

| 方法 | やること |
|---|---|
| ★**Cloud Shell**（最速） | プロンプトに出ています → `your_name@cloudshell:~ (ai-shacho-473812)$` の括弧内 |
| **コマンド** | `gcloud projects list` の `PROJECT_ID` 列。現在の選択は `gcloud config get-value project` |
| **画面** | https://console.cloud.google.com/home/dashboard の左上「プロジェクト情報」カード |
| **URL** | ブラウザのアドレスに `?project=ai-shacho-473812` として入っています |

### 2-2. 課金（請求先アカウント）の有効化

1. 左上の ≡ メニュー →「**お支払い**」
2. 案内に従ってクレジットカードを登録（無料トライアル中は自動請求されない）
3. プロジェクト `ai-shacho` に請求先アカウントをリンク

### 2-3. AI Studioのキーを課金プロジェクトに紐付け

1. **https://aistudio.google.com/apikey** に戻る
2. 作成済みキーの「プロジェクト」欄が無課金のままなら、「APIキーを作成」→
   「**既存のプロジェクトから作成**」で `ai-shacho` を選んで作り直す（こちらのキーを使う）

## STEP 3：Cloud Shellでデプロイ

**Cloud Shell** はブラウザの中で動くコマンド画面です。PCへのインストールは一切不要です。

1. **https://console.cloud.google.com/** の画面右上にある **「>_」アイコン**（Cloud Shellをアクティブにする）をクリック
2. 画面下に黒いコマンド画面が開くのを待つ（初回は1分ほど）
3. 以下のコマンドを**1ブロックずつ**コピーして貼り付け、Enterで実行する

```bash
# ① プロジェクトを選択（ai-shacho 部分は自分のプロジェクトIDに。画面上部で確認できる）
gcloud config set project ai-shacho
```

```bash
# ② アプリのコードを取得
git clone https://github.com/Hiroto08/ai_sasaki.git
cd ai_sasaki
```

> 🚨 **★最重要：ブランチを確認してください。**
> `git clone` は既定ブランチ（`main`）を取ってきます。
> **開発中の内容が `main` にマージされていない場合、古いアプリがデプロイされます。**
>
> ```bash
> # いま何が入っているか確認する
> git log --oneline -1
> ```
>
> **マージがまだなら、開発ブランチを直接取ってください。**
>
> ```bash
> git checkout claude/ai-ceo-avatar-app-wr3hem
> git log --oneline -1   # 最新のコミットが出ればOK
> ```
>
> ⚠️ **`data/persona.md` にアンケート反映後の「人物像」節があるか**を必ず見てください。
> 無ければ古い版です。**口調がまったく別人になります。**
>
> ```bash
> grep -c "人物像" data/persona.md   # 1 以上なら新しい版
> ```

```bash
# ③ デプロイ（Cloud Runへ公開）。5分ほどかかる。
#    途中で「Enable required APIs? (y/N)」と聞かれたら y を入力。
#    リージョンを聞かれたら asia-northeast1（東京）の番号を入力。
gcloud run deploy ai-shacho \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --memory 512Mi \
  --set-env-vars "^@^GEMINI_API_KEY=ここにSTEP1のAPIキー@PASSPHRASE=ここに合言葉@SECRET=ここに下の固定値@MODEL=gemini-2.5-flash@MAX_TURNS=30@MAX_PER_MIN=10"
```

> 🚨 **★`SECRET` は必ず設定してください。**（2026/8/23 追記・実測で確認済み）
>
> `SECRET` はログイン用トークンの署名鍵です。**未設定だと、サーバー起動のたびに
> ランダムな値が作られます。** すると：
>
> - Cloud Run がコンテナを入れ替えた瞬間（**再デプロイ・自動再起動のどちらでも起きます**）
> - **入場済みの全員のトークンが無効になり、200人が一斉に合言葉画面へ戻されます**
>
> **実際に確認しました：**
>
> | 条件 | 再起動後に会話を続けられるか |
> |---|---|
> | `SECRET` を固定 | ✅ **通った（会話が継続できる）** |
> | `SECRET` 未設定 | ❌ **`unauthorized`（全員が合言葉画面に戻される）** |
>
> **下の値をそのままコピーして使ってください**（このイベント用に生成した32バイトの乱数です）。
>
> ```
> SECRET=534eaf7b08b74b9b9a107c3c7ce526d627000abd28b68fd3cf92bbf8d9f2e83c
> ```
>
> 💡 一度決めたら**イベントが終わるまで変えないでください。**
> 変えると、その瞬間に全員がログアウトします。

> 💡 `PASSPHRASE=` の後がイベントの**合言葉**になります（例：`PASSPHRASE=おめでとう`）。
> 💡 `--max-instances 1` は「サーバーを1台までしか増やさない」設定です。
>    1人あたりの発話制限を正しく効かせ、コストの上限を固定するために**必ず付けてください**。
> 💡 先頭の `^@^` は「区切り文字を @ にする」という指定です。合言葉に読点や記号が入っても
>    壊れないようにするためのもので、**そのまま貼り付けてください**。

**フリー質問（#4）で音声を使う場合**は、上のコマンドの環境変数に次を追加します。

```
@ELEVENLABS_API_KEY=ここにAPIキー@ELEVENLABS_VOICE_ID=ここにVoice ID
```

4. 完了すると最後に **Service URL: `https://ai-shacho-xxxxx.asia-northeast1.run.app`** と表示される。
   これが**アプリのURL**。メモ帳に控える

## STEP 4：動作確認

1. スマホとPCの両方で Service URL を開く
2. 確認項目：
   - [ ] 合言葉画面が出る → 間違った合言葉でエラーになる → 正しい合言葉で入場できる
   - [ ] チャットで質問すると佐々木社長風の回答が返る（AI応答モード）
   - [ ] 🌶️トグルで辛口モードに切り替わり、口調が変わる
   - [ ] 「おみくじ」「クイズ」「診断して」が動く
   - [ ] 画面下に「あと◯回お話しできます」が表示される

> ❗ 回答の末尾等に「デモモード」と出る場合はAPIキーが効いていません。
> 下のトラブルシューティング①へ。

## STEP 4.5：本人の写真に差し替える（許諾取得後）

**設定は最初から入っています。必要なのは写真ファイルを置くことだけです。**

```jsonc
// data/config.json — すでにこの状態
"avatar": { "image": "avatar.png", "consentConfirmed": true }
```

サーバーは「**許諾フラグが true**」かつ「**ファイルが実在する**」ときだけ写真を表示します。
どちらか欠けると、自動でイラストのままになります（事故防止のため）。

### 4.5-1. 写真を用意する

| 項目 | 指定 |
|---|---|
| ファイル名 | ★**`avatar.png`**（この名前でないと読まれません） |
| 形式 | PNG |
| サイズ | **縦長・200×230px 以上**（表示は 200×230 に `object-fit: cover` で切り抜き） |
| 構図 | ★**顔が中央**に来るように。上下が切れる前提で余白を取る |
| 背景 | 無地が無難（合言葉画面では 104×120px の小さい表示にもなります） |

### 4.5-2. Cloud Shell に置く

Cloud Shell 右上の **⋮（縦三点）→「アップロード」** でPCから `avatar.png` を送り、
`~/ai_sasaki/public/` へ移動します。

```bash
mv ~/avatar.png ~/ai_sasaki/public/avatar.png
ls -l ~/ai_sasaki/public/avatar.png    # 表示されればOK
```

### 4.5-3. 再デプロイ

```bash
cd ~/ai_sasaki
gcloud run deploy ai-shacho --source . --region asia-northeast1
```

> 💡 環境変数は前回の指定が引き継がれるので、`--set-env-vars` は付け直さなくて構いません。
> （付け直す場合は**全部**を指定してください。一部だけ書くと残りが消えます）

### 🚨 4.5-4. 写真が反映されないときは、まずここを見る

**`.gcloudignore` が無いと、gcloud は `.gitignore` を代用します。**
`.gitignore` は本人の写真をリポジトリに入れないため `public/*.png` を除外しているので、
**そのままだとアップロード自体から写真が抜け落ちます。**
エラーも警告も出ないまま、イラストのまま公開されるという分かりにくい失敗です。

→ **リポジトリに `.gcloudignore` を用意済みです**（2026/8/23 追加）。
　`git pull` して、ファイルがあることを確認してください。

```bash
cd ~/ai_sasaki && git pull && ls -l .gcloudignore
```

**チェックリスト**

- [ ] `ls ~/ai_sasaki/public/avatar.png` でファイルが見える
- [ ] `ls ~/ai_sasaki/.gcloudignore` が存在する
- [ ] ファイル名が `avatar.png`（大文字small違い・`.PNG`・`.jpg` は不可）
- [ ] 再デプロイ後、`https://サービスURL/avatar.png` を直接開いて写真が出る
      → ここで404なら、アップロードに含まれていません

> ⚠️ ★**写真はリポジトリにコミットされません**（本人の顔のため）。
> `git clone` をやり直すと写真は消えます。**その場合は 4.5-2 からやり直してください。**
> Cloud Shell のホームは保持されるので、`git pull` するだけなら消えません。

> 🚨 **イベント終了後、写真を削除してください。**
> `gcloud run services delete ai-shacho --region asia-northeast1` でサービスごと消せます
> （STEP 8）。本人の顔を含むコンテナイメージも Artifact Registry から削除します。

---

## STEP 5：QRコードを作る

1. **https://quickchart.io/qr-code-api/** などの無料QR生成、または検索で出る任意の
   「QRコード作成」サイトを開く
2. Service URL を貼り付けてQR画像を生成・ダウンロード
3. 印刷物やスライドに貼る。**QRの近くに合言葉は書かない**（別の場所で口頭・掲示で案内すると、通りすがりの第三者の利用を防げる）

> 💡 手軽な方法：Chromeなら Service URL を開いた状態でアドレスバー右の「共有」→
> 「QRコードを作成」でも生成できます。

## STEP 6：予算アラートを設定（コストの保険）

1. Google Cloudコンソール ≡ メニュー →「お支払い」→「**予算とアラート**」
2. 「予算を作成」→ 名前：`ai-shacho-event`、対象：プロジェクト `ai-shacho`
3. 金額：**1,500円**（目安）
4. しきい値 50%・90%・100% でメール通知（初期設定のままでOK）→「終了」

これで使いすぎるとメールが来ます。アプリ側にも1人30発話の上限があるため、
理論上の最大コストも約2,500円（200人×30発話）に収まります。

## STEP 7：イベント当日の朝にやること

```bash
# Cloud Shellで実行：常時1台を起動しておく（最初のアクセスが遅くなる「コールドスタート」を防ぐ）
gcloud run services update ai-shacho \
  --region asia-northeast1 \
  --min-instances 1
```

- [ ] スマホでQR→合言葉→チャット→両モードを一通り確認
- [ ] 予算アラートのメールが来ていないか確認

## STEP 8：イベント終了後の片付け

```bash
# ① サービスを削除（URLが無効になり、以後の課金もゼロ）
gcloud run services delete ai-shacho --region asia-northeast1
```

2. **https://aistudio.google.com/apikey** でAPIキーを削除（漏えいリスクをゼロに）
3. 「お支払い」で最終的な利用額を確認

---

## コンテンツ・合言葉の更新方法

### 口癖・おみくじ・クイズなどを変えたい

1. GitHubの `data/` フォルダ内のファイルを編集（ブラウザ上で鉛筆アイコン→編集→Commit）
   - 口癖・口調：`data/config.json`、`data/modes/normal.json`、`data/modes/spicy.json`
   - おみくじ等：`data/content/*.json`（配列に1行追記するだけ）
2. Cloud Shellで再デプロイ：

```bash
cd ~/ai_sasaki && git pull && gcloud run deploy ai-shacho --source . --region asia-northeast1
```

（約3分で反映。環境変数は前回設定が引き継がれる）

### 合言葉だけ変えたい（再デプロイ不要・数十秒）

```bash
gcloud run services update ai-shacho \
  --region asia-northeast1 \
  --update-env-vars "PASSPHRASE=あたらしいあいことば"
```

---

## トラブルシューティング

| # | 症状 | 原因と対処 |
|---|---|---|
| ① | 回答が「デモモード」のまま | APIキー未設定or誤り。`gcloud run services update ai-shacho --region asia-northeast1 --update-env-vars "GEMINI_API_KEY=正しいキー"` で設定し直す |
| ② | デプロイで `Billing account not found` | STEP 2-2の課金有効化が未完了。「お支払い」でプロジェクトに請求先をリンク |
| ③ | 回答が途中から返らなくなった | Geminiのレート制限の可能性。コンソールの「Cloud Run → ログ」で `Gemini API 429` を確認。無料枠キーなら課金プロジェクトのキーに差し替え（STEP 2-3） |
| ④ | 最初のアクセスだけ遅い | コールドスタート。当日朝の `--min-instances 1`（STEP 7）で解消 |
| ⑤ | 「セッションが切れました」が頻発 | ★**`SECRET` が未設定です**（STEP 3 参照）。設定し直して再デプロイしてください。設定済みなら、稼働中の再デプロイは避ける |
| ⑥ | 合言葉が合っているのに入れない | 全角/半角・大文字小文字は自動吸収されるが、余分なスペースに注意。`--update-env-vars` で設定値を確認・再設定 |

## 当日運用チェックリスト

- [ ] 前日：デプロイ済み・両モード動作確認・QR印刷・予算アラート設定
- [ ] 前日：負荷テスト実施（`node scripts/loadtest.js https://あなたのURL 200 3`※合言葉を`PASSPHRASE`環境変数で指定）
- [ ] 当日朝：`--min-instances 1` 実行、スマホで一通り確認
- [ ] 稼働中：Cloud Run「指標」タブでリクエスト数を時々確認
- [ ] 終了後：サービス削除・APIキー削除・利用額確認
