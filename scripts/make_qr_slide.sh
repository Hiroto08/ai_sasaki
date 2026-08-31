#!/usr/bin/env bash
# QR投影スライドを画像で書き出す。
# URL や合言葉を変えたときは、下の2行を直して実行する。
#
#   bash scripts/make_qr_slide.sh
#
# 必要なもの：Chromium（headless）と日本語フォント（Noto CJK JP）
set -euo pipefail

URL="https://ai-shacho-981107538052.asia-northeast1.run.app/"
PASSPHRASE="おめでとう"

OUT="assets/qr"
TMP="$(mktemp -d)"
mkdir -p "$OUT"

# QRを生成し、SVGの断片を作る（pip install segno が必要）
python3 - "$URL" "$TMP" <<'PY'
import sys, segno, io
url, tmp = sys.argv[1], sys.argv[2]
q = segno.make(url, error='m')          # 会場が暗いので、モジュールが大きい M を使う
m = [list(r) for r in q.matrix]; n = len(m)
d = []
for y, row in enumerate(m):
    x = 0
    while x < n:
        if row[x]:
            x0 = x
            while x < n and row[x]: x += 1
            d.append(f"M{x0} {y}h{x-x0}v1h-{x-x0}z")
        else: x += 1
svg = (f'<svg viewBox="-2 -2 {n+4} {n+4}">'
       f'<rect x="-2" y="-2" width="{n+4}" height="{n+4}" fill="#fff"></rect>'
       f'<path d="{"".join(d)}" fill="#000" shape-rendering="crispEdges"></path></svg>')
io.open(tmp + "/qr.svg", "w", encoding="utf-8").write(svg)
q.save(tmp + "/qr.png", scale=40, border=4)
PY

# テンプレートに QR・URL・合言葉を差し込む
python3 - "$TMP" "$URL" "$PASSPHRASE" <<'PY'
import sys, io, re
tmp, url, passphrase = sys.argv[1], sys.argv[2], sys.argv[3]
html = io.open("scripts/qr_slide_template.html", encoding="utf-8").read()
qr = io.open(tmp + "/qr.svg", encoding="utf-8").read()
html = re.sub(r'<div class="qrbox">.*?</div>', '<div class="qrbox">' + qr + '</div>', html, flags=re.S)
html = re.sub(r'(<span class="word">).*?(</span>)', r'\g<1>' + passphrase + r'\g<2>', html)
html = re.sub(r'(<div class="urltext">).*?(</div>)', r'\g<1>' + url + r'\g<2>', html)
io.open(tmp + "/slide.html", "w", encoding="utf-8").write(html)
PY

CHROME="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)"
for scale in 1 2; do
  px=$(( 1920 * scale ))
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=$scale --window-size=1920,1080 \
    --screenshot="$OUT/qr_slide_${px}.png" "file://$TMP/slide.html" >/dev/null 2>&1
  echo "書き出し: $OUT/qr_slide_${px}.png"
done
cp "$TMP/qr.png" "$OUT/qr_ai_shacho.png"
cp "$TMP/qr.svg" "$OUT/qr_ai_shacho_raw.svg"
rm -rf "$TMP"
