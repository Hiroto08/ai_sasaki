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
4. プロジェクト名：`ai-shacho`（任意）→「作成」
5. 作成後、画面上部のプロジェクト選択で `ai-shacho` を選んでおく

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
  --set-env-vars "GEMINI_API_KEY=ここにSTEP1のAPIキー,PASSPHRASE=ここに合言葉,MODEL=gemini-2.5-flash,MAX_TURNS=30"
```

> 💡 `PASSPHRASE=` の後がイベントの**合言葉**になります（例：`PASSPHRASE=きがきくね`）。
> 💡 `--max-instances 1` は「サーバーを1台までしか増やさない」設定です。
>    1人あたりの発話制限を正しく効かせ、コストの上限を固定するために**必ず付けてください**。

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
| ⑤ | 「セッションが切れました」が頻発 | 再デプロイでトークンが無効化されたため。稼働中の再デプロイは極力避けるか、`SECRET` 環境変数に固定値を設定しておく |
| ⑥ | 合言葉が合っているのに入れない | 全角/半角・大文字小文字は自動吸収されるが、余分なスペースに注意。`--update-env-vars` で設定値を確認・再設定 |

## 当日運用チェックリスト

- [ ] 前日：デプロイ済み・両モード動作確認・QR印刷・予算アラート設定
- [ ] 前日：負荷テスト実施（`node scripts/loadtest.js https://あなたのURL 200 3`※合言葉を`PASSPHRASE`環境変数で指定）
- [ ] 当日朝：`--min-instances 1` 実行、スマホで一通り確認
- [ ] 稼働中：Cloud Run「指標」タブでリクエスト数を時々確認
- [ ] 終了後：サービス削除・APIキー削除・利用額確認
