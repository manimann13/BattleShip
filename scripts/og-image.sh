#!/bin/sh
# Captures public/og-image.png (the link preview) from the dev server. Run `npm run dev` first.
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --hide-scrollbars --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot="$(pwd)/public/og-image.png" "http://localhost:5173/scripts/og/index.html"
echo "Wrote public/og-image.png"
