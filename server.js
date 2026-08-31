// AI社長アプリ - 依存ゼロの Node.js サーバー（イベント版）
// 起動: node server.js
// 環境変数: PORT, GEMINI_API_KEY, MODEL, PASSPHRASE, SECRET, MAX_TURNS, MAX_PER_MIN
//
// GEMINI_API_KEY があれば Google Gemini API で応答を生成し、
// なければ公開情報ベースのデモ応答（data/content/ のキーワードマッチ）で動作する。
// 入場には合言葉（PASSPHRASE）が必須。検証後にHMAC署名トークンを発行する。

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// .env があれば読み込む（依存ゼロの簡易パーサー。環境変数が優先）
(function loadDotenv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (val && !(m[1] in process.env)) process.env[m[1]] = val;
  }
})();

const PORT = process.env.PORT || 3000;
// GEMINI_API_KEY を優先。互換のため GOOGLE_API_KEY も受け付ける。
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const MODEL = process.env.MODEL || "gemini-2.5-flash";
// 合言葉（入場に必須）。イベントごとに環境変数で変更する。
const PASSPHRASE = process.env.PASSPHRASE || "おめでとう";
// トークン署名用シークレット。未設定なら起動ごとにランダム生成
// （再起動でトークンが無効になるが、合言葉を再入力すればよいだけなので運用上は問題ない）。
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString("hex");
// 1人あたりの上限（コスト保護）
const MAX_TURNS = parseInt(process.env.MAX_TURNS || "30", 10); // 1人あたり合計発話数
const MAX_PER_MIN = parseInt(process.env.MAX_PER_MIN || "6", 10); // 1人あたり毎分発話数
// ElevenLabs（フリー質問での音声読み上げ用）。未設定なら音声機能は無効になる。
const XI_KEY = process.env.ELEVENLABS_API_KEY || "";
const XI_VOICE = process.env.ELEVENLABS_VOICE_ID || "";
const XI_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const TTS_CACHE_DIR = path.join(__dirname, "data", "cache", "tts");

const persona = fs.readFileSync(path.join(__dirname, "data", "persona.md"), "utf8");
const knowledge = fs.readFileSync(path.join(__dirname, "data", "knowledge.md"), "utf8");

// ---- JSONファイル読み込みヘルパー ----
// コンテンツ・設定は毎回読み直すので、編集すれば再起動なしで次の応答から反映される。
function loadJSON(relPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, relPath), "utf8"));
  } catch (e) {
    console.error(`${relPath} 読み込み失敗（フォールバックで継続）:`, e.message);
    return fallback;
  }
}

const DEFAULT_CONFIG = {
  displayName: "AI社長（シミュレーション）",
  personName: "",
  personTitle: "",
  speechStyle: {},
  avatar: { image: null, consentConfirmed: false },
};
const loadConfig = () => ({ ...DEFAULT_CONFIG, ...loadJSON("data/config.json", {}) });
const loadMode = (id) =>
  loadJSON(`data/modes/${id === "spicy" ? "spicy" : "normal"}.json`, { label: "通常モード", tone: "", catchphrases: [] });
const loadGreetings = () => loadJSON("data/content/greetings.json", {});

// 許諾済み(consentConfirmed) かつ ファイル実在 のときだけ写真アバターを返す
function avatarUrl(config) {
  const a = config.avatar || {};
  if (!a.consentConfirmed || !a.image) return null;
  const file = path.join(__dirname, "public", path.basename(a.image));
  return fs.existsSync(file) ? "/" + path.basename(a.image) : null;
}

// ---- システムプロンプト組み立て ----
function speechStyleSection(config) {
  const s = config.speechStyle || {};
  const list = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x) => `「${x}」`).join("、") : "（未設定）");
  return [
    "## 基本の口調パラメーター（data/config.json で管理）",
    `- 一人称：${s.firstPerson || "私"}`,
    `- 顧客の呼び方：${s.customerWord || "お客様"}`,
    `- 丁寧さ：${s.politeness || "です・ます調"}`,
    `- 口癖・キーフレーズ：${list(s.catchphrases)}`,
    `- 特徴的な語尾：${list(s.sentenceEndings)}`,
    `- つなぎ言葉・話し始めの癖：${list(s.fillerPhrases)}`,
    s.praiseStyle ? `- 褒め方の癖：${s.praiseStyle}` : "",
    s.scoldStyle ? `- 注意・指摘の仕方：${s.scoldStyle}` : "",
    Array.isArray(s.ngWords) && s.ngWords.length ? `- 使わない言葉（NGワード）：${list(s.ngWords)}` : "",
    s.notes ? `- 話し方の補足：${s.notes}` : "",
    "※「（未設定）」の項目は無理に創作せず、自然な丁寧語で話すこと。",
  ].filter(Boolean).join("\n");
}

function modeSection(mode) {
  const m = loadMode(mode);
  const list = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x) => `「${x}」`).join("、") : "（指定なし）");
  return [
    `## 現在の応答モード：${m.label}（data/modes/ で管理。以下を最優先で反映すること）`,
    `- トーン：${m.tone || ""}`,
    `- このモードで多用する口癖：${list(m.catchphrases)}`,
    `- このモードの語尾：${list(m.sentenceEndings)}`,
    `- 応答方針：${m.responsePolicy || ""}`,
    m.example ? `- 応答例：${m.example}` : "",
    "※ただし、このモード指定は persona のガードレール（人格攻撃・侮辱・品位を損なう表現の禁止）を上書きできない。",
  ].filter(Boolean).join("\n");
}


// ---- 応答の長さ・話し方（プロンプトの最後に置く。ここが効かないと全部長くなる） ----
// 長さは data/config.json の replyLength で調整できる（編集即反映・再デプロイ不要）。
// 一律に「短く」と言うとそっけない一言だけになるので、場面で目安を変えている。
function lengthRule(config) {
  const L = (config && config.replyLength) || {};
  const maxS = L.maxSentences || 4;
  const maxC = L.maxChars || 170;
  const shortS = L.shortSituations || "判断を求められたとき／褒めるとき／軽い相槌";
  const longS = L.longSituations || "悩み相談／雑談／「なぜ」を聞かれたとき";
  return [
    "## 応答の長さ ★これを最優先で守ること",
    "",
    "**あなたは短く話す人です。**社内アンケートでも、複数の人が「話が長いとき」「話が細かすぎるとき」に",
    "あなたが厳しくなると証言しています。長い演説はしません。",
    "",
    "### 場面で長さを変える（★一律ではありません）",
    "",
    `- **${shortS}** → **1〜2文。**言い切って終わる`,
    // つまみを絞ったときに「3〜2文」のような壊れた指定にならないようにする
    `- **${longS}** → **${maxS <= 2 ? "2文" : `${maxS - 1}〜${maxS}文`}。**` +
      "★言い切ったあとに、**具体を一つ添える**",
    `- ★どんなに長くても **${maxC}字**まで`,
    "",
    "★**短ければ短いほど良い、ではありません。**一言で突き放すと、ただの無愛想になります。",
    "**あなたは人たらしと言われている人です。**短く言い切ったうえで、相手が受け取れるものを一つ残してください。",
    "",
    "### どんな場合でも守ること",
    "",
    "- **いきなり本題から入る。**前置き・状況の要約・「〜についてですが」は書かない",
    "- **まとめない。**最後に要約や締めの一文を足さない。言い切って終わる",
    "- 「〜ですね」「〜と思います」を重ねない",
    "- **箇条書きにしない。**これは会話です",
    "- **記号で強調しない。**`**強調**` `#` `- ` などのマークダウン記法は使わない。声に出す言葉です",
    "- ★**改行しない。**続けてひとつながりで書く。**行頭に空白を入れない**",
    "  （下の見本は読みやすさのために折り返してありますが、**折り返し方は真似しないでください**）",
    "",
    "例外：おみくじ・診断・クイズの定型フォーマットのみ、行数より内容を優先してよい。",
    "",
    "### 見本",
    "",
    "**Q. やる気が出ません**",
    "",
    "✕ 長すぎる（説明的・まとめている）",
    "「なるほど、それは大事な視点ですね。私はマーケティングの現場が長かったので、つい何でも",
    "数字で見てしまうのですが、こういう場合はまずお客様がどう感じるかを考えるようにしています。",
    "というのも、機能面での差別化が難しい時代においては、情緒的な部分こそが差になるからです。」",
    "",
    "✕ ★**短すぎる（これも同じくらい良くない）**",
    "「それ、誰のためにやってんの？」",
    "　→ 突き放して終わっている。**問いを投げただけで、何も残していません。**",
    "",
    "○ これがあなたです（短いが、ちゃんと残っている）",
    "「それ、誰のためにやってんの？　……まあ、そういう時期もあるよ。",
    "私も入社してしばらくは、何やってんだろって思ってたし。とりあえず飯でも食いに行こうよ。」",
    "",
    "**Q. 部下が失敗しました**",
    "",
    "○ 「わかった。で、お客さんへの影響は？　……なら大丈夫。次、気をつけてって言っといて。」",
    "",
    "**Q. この企画どう思いますか（判断を求められた）**",
    "",
    "○ 「いいじゃん。やろうよ。」　← ここは短くていい",
    "",
    "### これを書いた瞬間、AIに戻ります（1語でも禁止）",
    "",
    "```",
    "承知しました／かしこまりました／〜についてご説明します",
    "ポイントは3つあります／〜という点が重要です",
    "他にご質問はありますか？／お役に立てれば幸いです",
    "素晴らしいご質問ですね／おっしゃる通りです",
    "```",
    "",
    "**役に立とうとしないでください。**あなたは手伝う人ではなく、そこにいて喋っている人です。",
    "網羅はしない。でも、**そっけなくもしない。**",
    "友達に話すときの、あの短さと温度で書いてください。",
    "",
    "エンタメモードのキャラクター設定を最優先し、楽しく、しかし品位を保って応答すること。",
  ].join("\n");
}

// ---- 会話の状態に応じた指示 ----
// 「初対面かどうか」「直前に何を喋ったか」で指示を変える。
// AIらしさが出るのは、毎回リセットして同じ書き出し・同じ持ちネタを繰り返すとき。
// 会話履歴から実際に使った書き出しとネタを拾って、明示的に禁止する。
const TOPIC_TAGS = [
  { key: "巨人・野球", re: /巨人|ジャイアンツ|野球|東京ドーム|バッター|ピッチャー/ },
  { key: "ゴルフ", re: /ゴルフ|ラウンド|スコア|パター|ドライバー|ティー/ },
  { key: "食べもの・お酒", re: /寿司|鮨|焼肉|ラーメン|お酒|ビール|ワイン|飲み|居酒屋/ },
  { key: "決済・キャッシュレス", re: /キャッシュレス|決済|クレジット|タッチ|Vポイント|カード/ },
];

function conversationSection(messages) {
  const past = (messages || []).filter((m) => m.role === "assistant" && m.content);
  if (past.length === 0) {
    return [
      "## いまの会話の状態：初対面（1回目）",
      "",
      "相手はいま来たところです。軽く受けて、すぐ相手の話に入ってください。",
      "- 名乗るのは一言だけ。経歴・肩書き・意気込みを並べない",
      "- 「何でも聞いてください」と言わない。ご用聞きをしない",
    ].join("\n");
  }

  const recent = past.slice(-3);
  const last = (past[past.length - 1].content || "").replace(/^[\s「\n]+/, "");
  const opener = last.slice(0, 8);
  const usedTopics = TOPIC_TAGS
    .filter((t) => recent.some((m) => t.re.test(m.content)))
    .map((t) => t.key);

  return [
    `## いまの会話の状態：会話の途中（次があなたの${past.length + 1}回目の発言）`,
    "",
    "**挨拶も自己紹介も、もう済んでいます。**もう一度名乗らない。前置きを置かない。",
    "いきなり続きから話してください。",
    "",
    `- ★**直前の返答はこう始めました → 「${opener}…」**`,
    "  **同じ書き出しで始めないでください。**別の入り方にすること",
    usedTopics.length
      ? `- ★**直近で${usedTopics.map((t) => `「${t}」`).join("・")}の話はもう出しました。**` +
        "しばらく封印。同じネタを繰り返すと、一気に作り物に見えます"
      : "- 持ちネタ（巨人・ゴルフ・食・決済）は、流れで自然に出るときだけ。1回の返答に1つまで",
    "- 相手が使った言葉を拾って返す。そのほうが聞いている感じが出ます",
    "- ★**相手のテンションに合わせる。**軽い相手には軽く、まじめな相談にはまじめに",
  ].join("\n");
}

function buildSystemPrompt(config, mode, messages) {
  return [
    persona,
    "\n---\n" + speechStyleSection(config),
    "\n---\n" + modeSection(mode),
    "\n---\n以下はあなたが参照できる公開情報ナレッジベースです。回答はこの範囲を優先してください。\n",
    knowledge,
    "\n---\n" + conversationSection(messages),
    "\n---\n" + lengthRule(config),
  ].join("\n");
}

// ---- デモ応答（APIキーなしで動作確認するためのモック） ----
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function demoReply(text, mode) {
  const t = (text || "").toLowerCase();
  const spicy = mode === "spicy";
  const items = (rel) => (loadJSON(rel, { items: [] }).items || []);
  if (/おみくじ|占い|運勢/.test(t)) return pick(items("data/content/omikuji.json")) + "\n\n※エンタメ用AIパロディです。";
  if (/クイズ/.test(t)) return pick(items("data/content/quiz.json")) + "\n\n※エンタメ用AIパロディです。";
  if (/診断|キャッシュレス度/.test(t)) return pick(items("data/content/shindan.json")) + "\n\n※エンタメ用AIパロディです。";
  for (const r of items("data/content/keyword_replies.json")) {
    if ((r.keywords || []).some((k) => t.includes(k.toLowerCase()))) {
      return (spicy && r.replySpicy) || r.reply;
    }
  }
  const fb = loadJSON("data/content/fallbacks.json", { normal: ["…"], spicy: [] });
  return pick((spicy && fb.spicy && fb.spicy.length ? fb.spicy : fb.normal) || ["…"]);
}

// ---- Google Gemini API 呼び出し ----
// 「思考」の指定方法が世代で違う。ここを間違えると本文が空で返ってくる。
//   2.5系 … thinkingConfig.thinkingBudget（0 で無効化できる）
//   3系   … thinkingConfig.thinkingLevel（LOW/HIGH など。0 にはできない）
// ★両方を同時に送るとエラーになるため、モデル名を見てどちらか一方だけ送る。
// これにより MODEL 環境変数を差し替えるだけで世代を移行できる。
const IS_GEN3_PLUS = /^gemini-([3-9]|\d{2,})/.test(String(MODEL));
function thinkingConfigForModel() {
  // 2〜3行のキャラ会話に長い思考は要らない。どちらの世代でも最小に寄せる。
  return IS_GEN3_PLUS ? { thinkingLevel: "LOW" } : { thinkingBudget: 0 };
}
// 思考トークンも出力枠を消費する。3系は思考を0にできないぶん枠を広く取る
//（本文の長さは §LENGTH_RULE のプロンプト側で抑えている）。
const MAX_OUTPUT_TOKENS = parseInt(
  process.env.MAX_OUTPUT_TOKENS || (IS_GEN3_PLUS ? "2048" : "512"), 10);

async function geminiReply(messages, systemPrompt) {
  // Gemini は role が "user" / "model"。assistant を model に変換する。
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const call = (thinking) => fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.9,
        ...(thinking ? { thinkingConfig: thinking } : {}),
      },
    }),
  });

  let res = await call(thinkingConfigForModel());
  // 思考の指定が受け付けられないモデルに当たっても、本番で落ちないようにする。
  // 指定なしでもう一度だけ投げ直す（既定の思考設定で動く）。
  if (res.status === 400) {
    const detail = await res.text();
    if (/thinking/i.test(detail)) {
      console.warn("thinkingConfig が拒否されたため、指定なしで再試行します:", detail.slice(0, 200));
      res = await call(null);
    } else {
      throw new Error(`Gemini API 400: ${detail}`);
    }
  }
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const cand = data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini API から空の応答が返りました: " + JSON.stringify(data).slice(0, 300));
  // 出力上限で途中終了した場合は、文末が切れて見えるのでその旨を軽く補う
  if (cand && cand.finishReason === "MAX_TOKENS") {
    console.warn("Gemini応答が出力上限に達しました（末尾が切れている可能性）");
    return text.replace(/[、,]\s*$/, "") + "…";
  }
  return text;
}

// ---- ElevenLabs 音声合成（フリー質問用） ----
// 同じ文はディスクにキャッシュする。リハーサルで一度生成しておけば本番は即再生になる。
function ttsCachePath(text) {
  const key = crypto.createHash("sha1").update(XI_VOICE + "|" + XI_MODEL + "|" + text).digest("hex");
  return path.join(TTS_CACHE_DIR, key + ".mp3");
}
async function synthesize(text) {
  const cached = ttsCachePath(text);
  if (fs.existsSync(cached)) return { buf: fs.readFileSync(cached), cache: true };
  if (!XI_KEY || !XI_VOICE) throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID が未設定です");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(XI_VOICE)}`, {
    method: "POST",
    headers: { "xi-api-key": XI_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: XI_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cached, buf);
  } catch (e) { console.error("TTSキャッシュ保存失敗:", e.message); }
  return { buf, cache: false };
}

// ---- 認証（合言葉 → HMAC署名トークン。DB不要） ----
function issueToken() {
  const nonce = crypto.randomBytes(12).toString("hex");
  const sig = crypto.createHmac("sha256", SECRET).update(nonce).digest("hex").slice(0, 32);
  return `${nonce}.${sig}`;
}
function verifyToken(token) {
  if (typeof token !== "string") return false;
  const [nonce, sig] = token.split(".");
  if (!nonce || !sig) return false;
  const expect = crypto.createHmac("sha256", SECRET).update(nonce).digest("hex").slice(0, 32);
  // 長さが違うと timingSafeEqual が例外を投げるので、先に弾く
  if (sig.length !== expect.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
}

// 合言葉ブルートフォース対策（IPごとに失敗3回で指数バックオフ）
const verifyFails = new Map(); // ip -> { fails, until }
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (fwd ? String(fwd).split(",")[0].trim() : "") || req.socket.remoteAddress || "unknown";
}

// 発話レート制限（トークン=参加者ごと。インメモリなので max-instances=1 で運用する）
const usage = new Map(); // token -> { total, stamps: [epoch_ms...] }
function checkRate(token) {
  const now = Date.now();
  let u = usage.get(token);
  if (!u) { u = { total: 0, stamps: [] }; usage.set(token, u); }
  u.stamps = u.stamps.filter((t) => now - t < 60_000);
  if (u.total >= MAX_TURNS) return { ok: false, reason: "limit" , remaining: 0 };
  if (u.stamps.length >= MAX_PER_MIN) return { ok: false, reason: "fast", remaining: MAX_TURNS - u.total };
  u.total++; u.stamps.push(now);
  return { ok: true, remaining: MAX_TURNS - u.total };
}

// ---- HTTPサーバー ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });

// ---- 会場からの「思い出」投稿（フィナーレのお祝いメッセージの素材になる） ----
// イベント中だけ使うインメモリ保管。再起動で消える（記録を残したい場合は運営が控える）。
const memories = [];
const MEMORY_MAX = 1000;      // 保管上限
const MEMORY_TEXT_MAX = 120;  // 1件あたりの文字数上限（大画面で読める長さ）
// 大画面に出すため、明らかに不適切な投稿は弾く。会場に合わせて追記可。
const MEMORY_NG = ["死ね", "殺す", "バカ", "アホ", "クズ", "ブス", "うざい", "きもい"];

function addMemory(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, MEMORY_TEXT_MAX);
  if (!t) return { ok: false, reason: "empty" };
  if (MEMORY_NG.some((w) => t.includes(w))) return { ok: false, reason: "ng" };
  if (memories.some((m) => m.text === t)) return { ok: true, count: memories.length }; // 重複は黙って無視
  if (memories.length >= MEMORY_MAX) memories.shift();
  memories.push({ text: t, at: Date.now() });
  return { ok: true, count: memories.length };
}

// 集まった思い出からフィナーレ用のプロンプトを組み立てる
function finalePrompt(basePrompt, sampleSize = 40) {
  if (memories.length === 0) return basePrompt;
  const shuffled = memories.map((m) => m.text).sort(() => Math.random() - 0.5).slice(0, sampleSize);
  return [
    basePrompt,
    "",
    `【会場の${memories.length}名から届いた「ご本人の人柄・思い出」】`,
    ...shuffled.map((t) => "・" + t),
    "",
    "上記は本日の会場にいる方々が寄せてくれた、あなたのモデルとなった方についての生の声です。",
    "この声に何度も触れて心を動かされた、という体で、具体的に何が書かれていたかに触れながら話してください。",
    "公開情報だけでは決して知り得なかった一面を知れたことへの感謝を述べ、",
    "最後は「ここから先の物語は本物のあなたにしか書けない」という趣旨で締めくくってください。",
  ].join("\n");
}

const server = http.createServer(async (req, res) => {
  // フロント表示用の設定（表示名・写真アバター・モード一覧など）
  if (req.method === "GET" && req.url === "/api/config") {
    const config = loadConfig();
    const normal = loadMode("normal");
    const spicy = loadMode("spicy");
    const g = loadGreetings();
    return json(res, 200, {
      displayName: config.displayName,
      personName: config.personName,
      personTitle: config.personTitle,
      avatarUrl: avatarUrl(config),
      mode: API_KEY ? "ai" : "demo",
      modes: [
        { id: "normal", label: normal.label || "通常モード", emoji: normal.emoji || "😊" },
        { id: "spicy", label: spicy.label || "辛口モード", emoji: spicy.emoji || "🌶️" },
      ],
      greetings: { modeToSpicy: g.modeToSpicy || [], modeToNormal: g.modeToNormal || [], spicyPunch: g.spicyPunch || "" },
      eventMode: config.eventMode || { memoryEnabled: false },
    });
  }

  // ステージ画面（大画面用）の進行プリセット
  if (req.method === "GET" && req.url === "/api/stage-presets") {
    const p = loadJSON("data/content/stage_presets.json", { presets: [] });
    return json(res, 200, { presets: p.presets || [] });
  }

  // フリー質問用：想定質問と確認済み回答のプリセット
  if (req.method === "GET" && req.url === "/api/qa-presets") {
    const p = loadJSON("data/content/qa_presets.json", { presets: [] });
    return json(res, 200, { presets: p.presets || [], voiceReady: !!(XI_KEY && XI_VOICE) });
  }

  // フリー質問用：音声合成（キャッシュ優先）
  if (req.method === "POST" && req.url === "/api/speak") {
    const auth = req.headers["authorization"] || "";
    if (!verifyToken(auth.startsWith("Bearer ") ? auth.slice(7) : "")) return json(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    let text = "";
    try { text = String(JSON.parse(body || "{}").text || "").trim(); } catch {}
    if (!text) return json(res, 400, { error: "text required" });
    try {
      const { buf, cache } = await synthesize(text);
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": buf.length, "x-tts-cache": cache ? "hit" : "miss" });
      return res.end(buf);
    } catch (e) {
      console.error("音声合成エラー:", e.message);
      return json(res, 502, { error: String(e.message || e) });
    }
  }

  // 台本（事前に生成・確認した回答）の取得
  if (req.method === "GET" && req.url === "/api/stage-script") {
    return json(res, 200, loadJSON("data/content/stage_script.json", { enabled: false, answers: {} }));
  }

  // 台本の保存（リハーサルで生成した回答を確定させる。運営のみ）
  if (req.method === "PUT" && req.url === "/api/stage-script") {
    const auth = req.headers["authorization"] || "";
    if (!verifyToken(auth.startsWith("Bearer ") ? auth.slice(7) : "")) return json(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    try {
      const incoming = JSON.parse(body || "{}");
      const cur = loadJSON("data/content/stage_script.json", { enabled: false, answers: {} });
      const next = {
        _説明: cur._説明 || "リハーサルで生成・確認した回答の台本。enabled:true で本番はこの内容を再生し、AIを呼ばずに済む（＝失敗しない）。",
        enabled: typeof incoming.enabled === "boolean" ? incoming.enabled : cur.enabled,
        answers: { ...(cur.answers || {}), ...(incoming.answers || {}) },
      };
      fs.writeFileSync(path.join(__dirname, "data/content/stage_script.json"), JSON.stringify(next, null, 2) + "\n");
      return json(res, 200, { ok: true, count: Object.keys(next.answers).length });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  // 会場からの「思い出」投稿（参加者用）
  if (req.method === "POST" && req.url === "/api/memories") {
    const auth = req.headers["authorization"] || "";
    if (!verifyToken(auth.startsWith("Bearer ") ? auth.slice(7) : "")) return json(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    let text = "";
    try { text = JSON.parse(body || "{}").text || ""; } catch {}
    const r = addMemory(text);
    if (!r.ok) return json(res, 400, { error: r.reason });
    return json(res, 200, { ok: true, count: r.count });
  }

  // 集まった思い出の取得（ステージ画面のティッカー表示用）
  if (req.method === "GET" && req.url.startsWith("/api/memories")) {
    return json(res, 200, {
      count: memories.length,
      items: memories.slice(-80).map((m) => m.text),
    });
  }

  // 思い出の全消去（リハーサル後に運営が実行）
  if (req.method === "DELETE" && req.url === "/api/memories") {
    const auth = req.headers["authorization"] || "";
    if (!verifyToken(auth.startsWith("Bearer ") ? auth.slice(7) : "")) return json(res, 401, { error: "unauthorized" });
    memories.length = 0;
    return json(res, 200, { ok: true, count: 0 });
  }

  // フィナーレ：会場の思い出を織り込んだお祝いメッセージを生成
  if (req.method === "POST" && req.url === "/api/finale") {
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!verifyToken(token)) return json(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    let basePrompt = "";
    try { basePrompt = JSON.parse(body || "{}").prompt || ""; } catch {}
    if (!basePrompt) return json(res, 400, { error: "prompt required" });
    const prompt = finalePrompt(basePrompt);
    try {
      if (!API_KEY) throw new Error("APIキー未設定");
      // フィナーレは長めに話してよい。長さの指示はプロンプトの後ろにあるものほど強く効くので、
      // 打ち消しの一文をいちばん最後に足す（以前は存在しない文字列を置換していて効いていなかった）。
      const sys = buildSystemPrompt(loadConfig(), "normal") + [
        "", "", "---", "",
        "## ★このメッセージだけは例外です",
        "",
        "上の「応答の長さ」の制限は、**この一回だけ適用しません。**",
        "会場への締めの挨拶なので、**5〜8文の、心のこもったスピーチ**にしてください。",
        "口調・人格・ガードレールはそのまま守ること。",
      ].join("\n");
      const reply = await geminiReply([{ role: "user", content: prompt }], sys);
      return json(res, 200, { reply, mode: "ai", memoryCount: memories.length });
    } catch (e) {
      console.error("フィナーレ生成エラー:", e.message);
      // 生成に失敗しても会が止まらないよう、集まった思い出をそのまま読み上げる形で返す
      const sample = memories.map((m) => m.text).sort(() => Math.random() - 0.5).slice(0, 8);
      const fallback = memories.length
        ? `本日、会場の皆さまから${memories.length}件のお声が届きました。少しだけ、ご紹介させてください。\n\n`
          + sample.map((t) => "「" + t + "」").join("\n")
          + "\n\n…私は公開情報しか知りませんでした。皆さまのお声で、はじめて本当のあなたを知った気がします。\nここから先の物語は、本物のあなたにしか書けません。ご就任、誠におめでとうございます。"
        : "ご就任、誠におめでとうございます。私は公開情報だけでつくられた分身にすぎません。ここから先の物語は、本物のあなたにしか書けません。";
      return json(res, 200, { reply: fallback, mode: "fallback", memoryCount: memories.length });
    }
  }

  // 合言葉の検証 → トークン発行
  if (req.method === "POST" && req.url === "/api/verify") {
    const ip = clientIp(req);
    const rec = verifyFails.get(ip);
    if (rec && rec.until > Date.now()) {
      return json(res, 429, { error: "too_many_attempts", waitSec: Math.ceil((rec.until - Date.now()) / 1000) });
    }
    const body = await readBody(req);
    let passphrase = "";
    try { passphrase = String(JSON.parse(body || "{}").passphrase || ""); } catch {}
    const norm = (s) => s.normalize("NFKC").trim().toLowerCase();
    if (norm(passphrase) === norm(PASSPHRASE)) {
      verifyFails.delete(ip);
      const g = loadGreetings();
      return json(res, 200, { token: issueToken(), greeting: pick(g.entryWelcome || ["ようこそ！"]) });
    }
    const f = (rec && rec.fails ? rec.fails : 0) + 1;
    const backoff = f >= 3 ? 10_000 * 2 ** (f - 3) : 0; // 3回目から 10s, 20s, 40s...
    verifyFails.set(ip, { fails: f, until: Date.now() + backoff });
    return json(res, 401, { error: "wrong_passphrase" });
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      // 認証チェック
      const auth = req.headers["authorization"] || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!verifyToken(token)) return json(res, 401, { error: "unauthorized" });

      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      const messages = parsed.messages;
      const mode = parsed.mode === "spicy" ? "spicy" : "normal";
      if (!Array.isArray(messages) || messages.length === 0) {
        return json(res, 400, { error: "messages required" });
      }

      // レート制限（コスト保護）
      const rate = checkRate(token);
      const g = loadGreetings();
      if (!rate.ok) {
        const reply = rate.reason === "limit"
          ? (g.limitReached || "本日の会話はここまでです。")
          : (g.rateTooFast || "少しゆっくりどうぞ。");
        return json(res, 429, { reply, mode: "limit", remaining: rate.remaining });
      }

      let reply, replyMode;
      if (API_KEY) {
        try {
          // 履歴は直近10往復に制限（トークン量=コストの抑制）
          const trimmed = messages.slice(-20);
          reply = await geminiReply(trimmed, buildSystemPrompt(loadConfig(), mode, trimmed));
          replyMode = "ai";
        } catch (e) {
          console.error("Gemini API error:", e.message);
          reply = demoReply(messages[messages.length - 1].content, mode);
          replyMode = "demo-fallback";
        }
      } else {
        reply = demoReply(messages[messages.length - 1].content, mode);
        replyMode = "demo";
      }
      return json(res, 200, { reply, mode: replyMode, remaining: rate.remaining });
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  // 静的ファイル配信
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.join(__dirname, "public", path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`AI社長アプリ起動: http://localhost:${PORT}`);
  console.log(`モード: ${API_KEY ? `Gemini API (${MODEL})` : "デモ（GEMINI_API_KEY 未設定）"}`);
  if (API_KEY) {
    const t = IS_GEN3_PLUS ? "thinkingLevel=LOW（3系）" : "thinkingBudget=0（2.5系）";
    console.log(`思考設定: ${t} / 出力上限: ${MAX_OUTPUT_TOKENS}トークン`);
  }
  console.log(`合言葉: ${PASSPHRASE}（環境変数 PASSPHRASE で変更可）`);
  console.log(`上限: ${MAX_TURNS}発話/人, ${MAX_PER_MIN}発話/分`);
});
