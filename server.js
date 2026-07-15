// AI社長アプリ - 依存ゼロの Node.js サーバー
// 起動: node server.js  (PORT, ANTHROPIC_API_KEY, MODEL は環境変数で指定)
//
// ANTHROPIC_API_KEY があれば Claude API で応答を生成し、
// なければ公開情報ベースのデモ応答（キーワードマッチ）で動作する。

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.MODEL || "claude-sonnet-5";

const persona = fs.readFileSync(path.join(__dirname, "data", "persona.md"), "utf8");
const knowledge = fs.readFileSync(path.join(__dirname, "data", "knowledge.md"), "utf8");

const SYSTEM_PROMPT = [
  persona,
  "\n---\n以下はあなたが参照できる公開情報ナレッジベースです。回答はこの範囲を優先してください。\n",
  knowledge,
  "\n---\n回答は日本語で、話し言葉として自然な長さ（3〜6文程度）にしてください。",
].join("\n");

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

const DEMO_FALLBACK =
  "ご質問ありがとうございます。ただ、その点は公開情報からはお答えしきれない部分ですね。私はマーケティングの現場で「お客様の当たり前を当たり前に」を追求してきましたので、迷ったときはまず、お客様にとってどうか、から考えてみてはいかがでしょうか。※これは公開情報に基づくAIシミュレーションであり、佐々木本人の発言ではありません。（デモモード：ANTHROPIC_API_KEY を設定するとAIが応答します）";

function demoReply(text) {
  const t = (text || "").toLowerCase();
  for (const r of DEMO_RESPONSES) {
    if (r.keywords.some((k) => t.includes(k))) return r.reply;
  }
  return DEMO_FALLBACK;
}

// ---- Claude API 呼び出し ----
async function claudeReply(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ---- HTTPサーバー ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
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
            reply = await claudeReply(messages);
            mode = "ai";
          } catch (e) {
            console.error("Claude API error:", e.message);
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
  console.log(`モード: ${API_KEY ? `Claude API (${MODEL})` : "デモ（ANTHROPIC_API_KEY 未設定）"}`);
});
