#!/bin/zsh
#
# LOCAL / DEV ONLY. Builds the Mac app on this Mac with a DEVELOPMENT web bundle that carries the invented sample
# household (src/db/dev-sample.ts, dev-data/sample.sqlite3), opens it, and loads the sample into the Mac app's own
# database (the app's container, ~/Library/Containers/com.cicis.app). Loading REPLACES whatever that database holds.
#
# Never for a release. It does not touch `npm run cap:sync`, dist/ or capacitor.config.json: the development bundle is
# built into mac/.build/web-sample and copied over ios/App/App/public only. archive-mac.sh refuses to archive while that
# bundle is there; `npm run cap:sync` puts the production bundle back.
set -euo pipefail

HERE=${0:A:h}
WEB=${HERE:h:h}
REPO=${WEB:h:h}
OUT=$HERE/.build/web-sample

if [[ ! -f $WEB/dev-data/sample.sqlite3 ]]; then
  (cd $REPO/packages/db && SAMPLE_OUT=../../apps/web/dev-data/sample.sqlite3 npx vitest run test/sample-data.test.ts)
fi
(cd $WEB && NODE_ENV=development npx vite build --mode development --outDir $OUT --emptyOutDir)
grep -rq 'Loading sample data' $OUT || { echo "the development bundle has no sample loader" >&2; exit 2; }
rsync -a --delete $OUT/ $WEB/ios/App/App/public/

$HERE/run-local.sh --no-open
APP=$WEB/ios/App/build/mac-dd/Build/Products/Debug-maccatalyst/cicis.app
# The shell's --route launch argument pushes /load-sample once the page is up; the dev bundle loads the sample then
# and reloads. Later launches open normally (open "$APP") and keep the sample.
open -n $APP --args --route /load-sample
echo "Opened $APP with the sample household loading."
