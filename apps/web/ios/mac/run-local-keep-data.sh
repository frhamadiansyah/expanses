#!/bin/zsh
#
# LOCAL / DEV ONLY. Rebuilds the Mac app on this Mac with the DEVELOPMENT web bundle (the same one run-local-sample.sh
# builds) and opens it WITHOUT loading the sample: whatever the app's own database holds — the sample loaded earlier,
# and anything the owner added since — is left exactly as it is. Use this for every rebuild once someone is trying the
# app; run-local-sample.sh replaces the database and is only for a deliberate fresh start.
#
# Never for a release: it does not touch `npm run cap:sync`, dist/ or capacitor.config.json, and archive-mac.sh refuses
# to archive while the development bundle is in App/public.
set -euo pipefail

HERE=${0:A:h}
WEB=${HERE:h:h}
OUT=$HERE/.build/web-sample

(cd $WEB && NODE_ENV=development npx vite build --mode development --outDir $OUT --emptyOutDir)
rsync -a --delete $OUT/ $WEB/ios/App/App/public/

osascript -e 'tell application id "com.cicis.app" to quit' 2>/dev/null || true
$HERE/run-local.sh --no-open
APP=$WEB/ios/App/build/mac-dd/Build/Products/Debug-maccatalyst/cicis.app
open -n $APP
echo "Opened $APP with its own data kept (no sample loaded)."
