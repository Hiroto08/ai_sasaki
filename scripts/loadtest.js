// 簡易負荷テスト（依存ゼロ）。デモモードのサーバーに対して実行すればAPI費用はかからない。
// 使い方: node scripts/loadtest.js [URL] [同時接続数] [1人あたり発話数]
//   例: node scripts/loadtest.js http://localhost:3000 200 3
// 環境変数 PASSPHRASE で合言葉を指定（省略時 "きがきくね"）

const BASE = process.argv[2] || "http://localhost:3000";
const CONCURRENCY = parseInt(process.argv[3] || "200", 10);
const TURNS = parseInt(process.argv[4] || "3", 10);
const PASSPHRASE = process.env.PASSPHRASE || "きがきくね";

const QUESTIONS = ["おみくじ", "クイズ出して", "診断して", "やる気が出ません", "キャッシュレスの未来は？"];
const results = { ok: 0, ng: 0, latencies: [] };

async function user(i) {
  try {
    const v = await fetch(`${BASE}/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: PASSPHRASE }),
    });
    if (!v.ok) throw new Error(`verify ${v.status}`);
    const { token } = await v.json();
    const history = [];
    for (let t = 0; t < TURNS; t++) {
      const q = QUESTIONS[(i + t) % QUESTIONS.length];
      history.push({ role: "user", content: q });
      const start = Date.now();
      const r = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history, mode: t % 2 ? "spicy" : "normal" }),
      });
      const data = await r.json();
      results.latencies.push(Date.now() - start);
      if (r.ok && data.reply) { results.ok++; history.push({ role: "assistant", content: data.reply }); }
      else if (r.status === 429) { results.ok++; break; } // レート制限は正常動作
      else results.ng++;
      await new Promise((s) => setTimeout(s, 500 + Math.random() * 1500));
    }
  } catch (e) {
    results.ng++;
  }
}

(async () => {
  console.log(`負荷テスト開始: ${BASE} / ${CONCURRENCY}人同時 / ${TURNS}発話ずつ`);
  const start = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => user(i)));
  const lat = results.latencies.sort((a, b) => a - b);
  const p = (q) => lat[Math.floor(lat.length * q)] || 0;
  console.log(`完了: ${((Date.now() - start) / 1000).toFixed(1)}秒`);
  console.log(`成功: ${results.ok} / 失敗: ${results.ng}`);
  console.log(`レイテンシ p50: ${p(0.5)}ms / p95: ${p(0.95)}ms / max: ${lat[lat.length - 1] || 0}ms`);
  process.exit(results.ng > 0 ? 1 : 0);
})();
