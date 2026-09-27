#!/bin/sh
# Build the web app, sync it into the iOS shell, build for a simulator and install it there.
# Usage: scripts/ios-sim.sh <simulator-udid> [marketing-version] [build-number]
# Env: DERIVED (xcodebuild derived data dir, default ios/DerivedData).
set -eu
UDID=${1:?simulator UDID}
MARKETING=${2:-1.0}
BUILD=${3:-1}
HERE=$(cd "$(dirname "$0")/.." && pwd)
DERIVED=${DERIVED:-$HERE/ios/DerivedData}
cd "$HERE"
npm run build
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator \
  -destination "id=$UDID" -derivedDataPath "$DERIVED" \
  MARKETING_VERSION="$MARKETING" CURRENT_PROJECT_VERSION="$BUILD" build -quiet
xcrun simctl install "$UDID" "$DERIVED/Build/Products/Debug-iphonesimulator/App.app"
