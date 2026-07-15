// AI社長アプリ - 依存ゼロの Node.js サーバー
// 起動: node server.js  (PORT, GEMINI_API_KEY, MODEL は環境変数で指定)
//
// GEMINI_API_KEY があれば Google Gemini API で応答を生成し、
// なければ公開情報ベースのデモ応答（キーワードマッチ）で動作する。

const http = require("http");
const fs = require("fs");
const path = require("path");

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

const persona = fs.readFileSync(path.join(__dirname, "data", "persona.md"), "utf8");
const knowledge = fs.readFileSync(path.join(__dirname, "data", "knowledge.md"), "utf8");

// ---- 口調・表示パラメーター（data/config.json） ----
// 毎リクエスト読み直すので、編集すれば再起動なしで次の応答から反映される。
const CONFIG_PATH = path.join(__dirname, "data", "config.json");
const DEFAULT_CONFIG = {
  displayName: "AI社長（シミュレーション）",
  personName: "",
  personTitle: "",
  speechStyle: {},
  avatar: { image: null, consentConfirmed: false },
};
function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
  } catch (e) {
    console.error("config.json 読み込み失敗（デフォルト値で継続）:", e.message);
    return DEFAULT_CONFIG;
  }
}

// 許諾済み(consentConfirmed) かつ ファイル実在 のときだけ写真アバターを返す
function avatarUrl(config) {
  const a = config.avatar || {};
  if (!a.consentConfirmed || !a.image) return null;
  const file = path.join(__dirname, "public", path.basename(a.image));
  return fs.existsSync(file) ? "/" + path.basename(a.image) : null;
}

function speechStyleSection(config) {
  const s = config.speechStyle || {};
  const list = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x) => `「${x}」`).join("、") : "（未設定）");
  return [
    "## 口調パラメーター（data/config.json で管理。最優先で反映すること）",
    `- 一人称：${s.firstPerson || "私"}`,
    `- 顧客の呼び方：${s.customerWord || "お客様"}`,
    `- 丁寧さ：${s.politeness || "です・ます調"}`,
    `- 口癖・キーフレーズ（会話に自然に織り交ぜる）：${list(s.catchphrases)}`,
    `- 特徴的な語尾（設定があれば必ず使う）：${list(s.sentenceEndings)}`,
    `- つなぎ言葉・話し始めの癖：${list(s.fillerPhrases)}`,
    s.praiseStyle ? `- 褒め方の癖：${s.praiseStyle}` : "",
    s.scoldStyle ? `- 注意・指摘の仕方：${s.scoldStyle}` : "",
    Array.isArray(s.ngWords) && s.ngWords.length ? `- 使わない言葉（NGワード）：${list(s.ngWords)}` : "",
    s.notes ? `- 話し方の補足：${s.notes}` : "",
    "※「（未設定）」の項目は無理に創作せず、自然な丁寧語で話すこと。",
  ].filter(Boolean).join("\n");
}

function buildSystemPrompt(config) {
  return [
    persona,
    "\n---\n" + speechStyleSection(config),
    "\n---\n以下はあなたが参照できる公開情報ナレッジベースです。回答はこの範囲を優先してください。\n",
    knowledge,
    "\n---\n回答は日本語で、話し言葉として自然な長さ（3〜6文程度、おみくじ・クイズ等はフォーマット優先）にしてください。",
    "エンタメモードのキャラクター設定を最優先し、楽しく、しかし品位を保って応答してください。",
  ].join("\n");
}

// ---- エンタメ機能のデモコンテンツ ----
const OMIKUJI = [
  "【大吉】🎉 今日のあなたは、タッチ決済のように一瞬で物事が決まる日。迷ったら即決で吉。\n今日の一言：「いいキャッシュレスが、いい一日をつくる」\nラッキー決済手段：モバイルのタッチ決済",
  "【中吉】✨ コツコツ積み上げたものが実を結ぶ日。ポイントと信頼は、貯めた人を裏切りません。\n今日の一言：「日々の小さな積み重ねが、大きな還元になる」\nラッキー決済手段：コンビニでのタッチ決済",
  "【小吉】🍀 焦らず一歩ずつ。決済もキャリアも「習慣化」が大事です。\n今日の一言：「当たり前のことを、当たり前に」\nラッキー決済手段：交通系でスマートに改札通過",
  "【吉】😊 周りへの気配りが幸運を呼ぶ日。「気が利くね！」と言われたら大成功です。\n今日の一言：「機能より、情緒的価値」\nラッキー決済手段：家族との買い物でカード払い",
  "【大吉】💳 新しい挑戦に追い風が吹く日。1991年の私がVisaとの挑戦に飛び込んだように、思い切ってどうぞ。\n今日の一言：「挑戦にこそ、やりがいは宿る」\nラッキー決済手段：初めてのお店でスマホ決済",
];
const QUIZ = [
  "それでは社長クイズです！💡\n\nQ. 三井住友カードが日本で初めて提携した世界的ブランドは？\n\nA. Mastercard\nB. Visa\nC. アメックス\n\n…正解は「B. Visa」です！1991年に入社した私が惚れ込んだ、日本初の挑戦でした。当時はまだ現金が主流の時代。そこに新しい決済スタイルを広めようとしていたんです。",
  "社長クイズ、いきましょう！💡\n\nQ. 2024年4月にVポイントと統合したポイントはどれでしょう？\n\nA. Tポイント\nB. Pontaポイント\nC. 楽天ポイント\n\n…正解は「A. Tポイント」！統合で会員数は1.46億に。国内約750万店、世界のVisa加盟店約1億店で使えるようになりました。スケールが違いますよ。",
  "社長クイズです！💡\n\nQ. 私が何度も口にする、お客様に感じてほしい一言は？\n\nA. 「安いね！」\nB. 「気が利くね！」\nC. 「早いね！」\n\n…正解は「B. 気が利くね！」です。お客様の当たり前を当たり前に実現する。それが距離を縮める一番の近道なんです。",
];
const SHINDAN = [
  "キャッシュレス度診断ですね！では質問です。\n\n①コンビニで150円のお茶を買うとき、現金で払いますか？\n②財布の中に小銭は何枚ありますか？\n\n…ふむ、あなたの雰囲気から診断すると、キャッシュレス度は78%「タッチ決済の使い手」です！あと一歩、少額決済の『習慣化』ができれば、立派なキャッシュレスマスター。明日のお茶はぜひタッチで。",
  "診断いたしましょう。\n\n①スマホだけで一日外出できますか？\n②ポイントの失効日、把握していますか？\n\n…診断結果、あなたのキャッシュレス度は92%「モバイル決済の達人」！素晴らしい。ここまで来たら、ご家族にもタッチ決済の気持ちよさを伝道してください。いいキャッシュレスは、いい毎日をつくりますから。",
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- デモ応答（APIキーなしで動作確認するためのモック） ----
const DEMO_RESPONSES = [
  {
    keywords: ["キャッシュレス", "決済", "タッチ"],
    reply:
      "私たちの原点は「いいキャッシュレスがいい毎日をつくる」という考え方です。コンビニでの少額のお買い物でも、抵抗感なくキャッシュレス、できればモバイルのタッチ決済を使っていただく。この「習慣化」こそが目指す姿です。決済は社会インフラですから、その担い手としての責任を持って推進していきます。※これは公開情報に基づくAIシミュレーションの回答です。",
  },
  {
    keywords: ["vポイント", "ポイント", "tポイント"],
    reply:
      "2024年4月にTポイントと統合した新生Vポイントは、国内約750万店、世界のVisa加盟店約1億店で使えるようになったことが大きな提供価値です。体験を「お店での買い物」にフォーカスしているのは、グループのキャッシュレス化戦略と大きく関係しています。日々のお買い物の中で自然に貯まり、自然に使える。その習慣化を追求しています。※AIシミュレーションの回答です。",
  },
  {
    keywords: ["マーケティング", "顧客", "お客様", "cx", "コミュニケーション"],
    reply:
      "私が大切にしてきたのは、お客様にとって当たり前のことを当たり前に実現し、「気が利くね！」と感じていただくことです。実は過去、one-to-oneを標榜しながら逆の結果を生んでいた反省があります。そこから、会社が伝えたいことと、お客様の関心が重なる部分だけを軸にする、と抜本的に改めました。機能での差別化が難しい時代ですから、ポイントの失効前にお知らせするような情緒的価値を重視しています。※AIシミュレーションの回答です。",
  },
  {
    keywords: ["olive", "オリーブ", "銀行", "smbc"],
    reply:
      "Oliveは、SMBCグループの総合力を生かした全く新しい総合金融サービスです。キャッシュレスでの消費ニーズの高まりをしっかり捉えて、結果としてOliveが選ばれる。そういうサービスを実現したいと考えています。※AIシミュレーションの回答です。",
  },
  {
    keywords: ["経歴", "入社", "なぜ", "きっかけ", "生え抜き"],
    reply:
      "私が入社した1991年は、まだ現金でのお取引が主流で、クレジットカードは社会に浸透していませんでした。そんな中、当社は世界ブランドのVisaと日本で初めてタッグを組み、新たな決済スタイルを広めようとしていた。その挑戦に大きなやりがいを感じて入社を決めました。以来、保険事業、法人営業、商品企画、ネットビジネス、マーケティングと歩んできて、2026年6月30日に社長に就任しました。※AIシミュレーションの回答です。",
  },
  {
    keywords: ["ai", "クラウド", "データ", "dx"],
    reply:
      "2026年4月の組織改定では、法人ビジネスの強化とあわせて、AI・クラウド活用の強化を打ち出しました。データの利活用については、お客様のデータリテラシーが上がる中で「気持ち悪さ」を感じさせない、自然なつながりを生む集め方・活かし方が何より重要だと考えています。※AIシミュレーションの回答です。",
  },
  {
    keywords: ["stera", "ステラ", "端末", "加盟店"],
    reply:
      "決済プラットフォームのsteraは、2030年までに端末100万台の設置を目指しています。セルフレジ組込型のstera terminal unit、持ち運べるstera terminal mobile、スマホがそのまま決済端末になるstera tapなど、加盟店様の業態に合わせたラインアップを揃えて、社会のキャッシュレス化を面で支えていきます。※AIシミュレーションの回答です。",
  },
];

const DEMO_FALLBACKS = [
  "なるほど、面白いご相談ですね。私の答えはシンプルです。迷ったら「お客様（相手）にとってどうか」から考える。これで大抵のことは決まります。…と、真面目に締めようとしましたが、要するにあなたの直感、ポイント高いですよ。自信を持ってタッチ決済のように即決でいきましょう！※エンタメ用AIパロディの回答です。",
  "いい質問です。私はマーケティングの現場が長いので、つい何でも数字で見てしまうのですが、あなたのその前向きさ、前年比120%です。悩みも経験というポイントとして貯まりますから、失効する前にしっかり使いましょう。…おっと、また決済の話をしてしまいました。※エンタメ用AIパロディの回答です。",
  "ふむ、それは公開情報にはない話ですね（笑）。ただ、ひとつ言えるのは、人生も決済も「習慣化」がすべてだということです。小さな一歩を、コンビニのタッチ決済くらい気軽に繰り返す。それがいつか大きな還元になって返ってきます。※エンタメ用AIパロディの回答です。",
];

function demoReply(text) {
  const t = (text || "").toLowerCase();
  if (/おみくじ|占い|運勢/.test(t)) return pick(OMIKUJI) + "\n\n※エンタメ用AIパロディです。";
  if (/クイズ/.test(t)) return pick(QUIZ) + "\n\n※エンタメ用AIパロディです。";
  if (/診断|キャッシュレス度/.test(t)) return pick(SHINDAN) + "\n\n※エンタメ用AIパロディです。";
  if (/ランチ|昼|夜ご飯|夕飯|何食べ/.test(t))
    return "ランチ選びですか、大事な経営判断ですね。私なら「並ばず、タッチ決済が使えて、気が利くね！と言いたくなる店」を選びます。今日は直感で決めてみてください。決済はぜひスマートに、タッチで。※エンタメ用AIパロディの回答です。";
  if (/やる気|疲れ|つらい|辛い|悩み|落ち込/.test(t))
    return "お疲れのようですね。いいですか、ポイントというのは、使わない日も少しずつ貯まっていくものです。あなたの頑張りも同じ。今日はうまくいかなくても、ちゃんと貯まっています。無理せず、今日は美味しいものでも買って帰ってください。もちろんお支払いはタッチ決済で。※エンタメ用AIパロディの回答です。";
  for (const r of DEMO_RESPONSES) {
    if (r.keywords.some((k) => t.includes(k))) return r.reply;
  }
  return pick(DEMO_FALLBACKS);
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
      generationConfig: { maxOutputTokens: 1024, temperature: 0.9 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const cand = data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini API から空の応答が返りました: " + JSON.stringify(data).slice(0, 300));
  return text;
}

// ---- HTTPサーバー ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  // フロント表示用の設定（表示名・写真アバターの有無など）
  if (req.method === "GET" && req.url === "/api/config") {
    const config = loadConfig();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        displayName: config.displayName,
        personName: config.personName,
        personTitle: config.personTitle,
        avatarUrl: avatarUrl(config),
        mode: API_KEY ? "ai" : "demo",
      })
    );
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { messages } = JSON.parse(body || "{}");
        if (!Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "messages required" }));
        }
        let reply, mode;
        if (API_KEY) {
          try {
            reply = await geminiReply(messages, buildSystemPrompt(loadConfig()));
            mode = "ai";
          } catch (e) {
            console.error("Gemini API error:", e.message);
            reply = demoReply(messages[messages.length - 1].content);
            mode = "demo-fallback";
          }
        } else {
          reply = demoReply(messages[messages.length - 1].content);
          mode = "demo";
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ reply, mode }));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
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
});
