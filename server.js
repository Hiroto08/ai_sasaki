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
const PASSPHRASE = process.env.PASSPHRASE || "きがきくね";
// トークン署名用シークレット。未設定なら起動ごとにランダム生成
// （再起動でトークンが無効になるが、合言葉を再入力すればよいだけなので運用上は問題ない）。
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString("hex");
// 1人あたりの上限（コスト保護）
const MAX_TURNS = parseInt(process.env.MAX_TURNS || "30", 10); // 1人あたり合計発話数
const MAX_PER_MIN = parseInt(process.env.MAX_PER_MIN || "6", 10); // 1人あたり毎分発話数

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

function buildSystemPrompt(config, mode) {
  return [
    persona,
    "\n---\n" + speechStyleSection(config),
    "\n---\n" + modeSection(mode),
    "\n---\n以下はあなたが参照できる公開情報ナレッジベースです。回答はこの範囲を優先してください。\n",
    knowledge,
    "\n---\n回答は日本語で、端的に2〜3行程度に収めてください。長々と説明せず、要点だけ話し言葉で述べること（おみくじ・クイズ等の定型フォーマットは行数より内容を優先してよい）。",
    "エンタメモードのキャラクター設定を最優先し、楽しく、しかし品位を保って応答してください。",
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
async function geminiReply(messages, systemPrompt) {
  // Gemini は role が "user" / "model"。assistant を model に変換する。
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.9,
        // gemini-2.5系は「思考」トークンも出力枠を消費し、本文が途中で切れる原因になる。
        // 2〜3行のキャラ会話には思考は不要なので無効化し、枠をすべて本文に使う。
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
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
    });
  }

  // ステージ画面（大画面用）の進行プリセット
  if (req.method === "GET" && req.url === "/api/stage-presets") {
    const p = loadJSON("data/content/stage_presets.json", { presets: [] });
    return json(res, 200, { presets: p.presets || [] });
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
          reply = await geminiReply(trimmed, buildSystemPrompt(loadConfig(), mode));
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
  console.log(`合言葉: ${PASSPHRASE}（環境変数 PASSPHRASE で変更可）`);
  console.log(`上限: ${MAX_TURNS}発話/人, ${MAX_PER_MIN}発話/分`);
});
