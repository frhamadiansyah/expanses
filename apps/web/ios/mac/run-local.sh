#!/bin/zsh
#
# Builds the Mac app (Debug, Mac Catalyst) and opens it, on this Mac, without a provisioning profile.
#
# "Sign to Run Locally": no Apple account is involved, so the build carries only the entitlements that need no
# profile (mac/App.mac-local.entitlements) — the same sandbox as the real Mac app, without iCloud. iCloud backup
# therefore shows as not available in this build; the TestFlight build (App/App.mac.entitlements) has it.
#
# Run `npm run cap:sync` in apps/web first when the web code changed. Pass --no-open to only build.
set -euo pipefail

HERE=${0:A:h}
APP_DIR=${HERE:h}/App
$HERE/build-capacitor-catalyst.sh
cd $APP_DIR
xcodebuild build \
  -workspace Mac.xcworkspace -scheme App -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst,arch=arm64' \
  -derivedDataPath build/mac-dd \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
  CODE_SIGN_ENTITLEMENTS=../mac/App.mac-local.entitlements \
  -quiet
APP=$APP_DIR/build/mac-dd/Build/Products/Debug-maccatalyst/cicis.app
echo "Built $APP"
[[ ${1:-} == --no-open ]] || open $APP
