#!/bin/zsh
#
# Builds Capacitor and Cordova for Mac Catalyst, the one thing the Mac app needs that npm does not ship.
#
# Why: the iOS app gets Capacitor from the official Swift package (capacitor-swift-pm), which is a pre-built binary
# with an iPhone slice and a simulator slice only — no Mac Catalyst slice, so a Mac build cannot link it. Capacitor's
# own Xcode project already supports Mac Catalyst (SUPPORTS_MACCATALYST = YES), so this script builds that project,
# at exactly the version in node_modules, into two xcframeworks next to ./capacitor-swift-pm/Package.swift.
#
# Mac.xcworkspace (apps/web/ios/App) lists ./capacitor-swift-pm as a local package. A local package with the same
# identity as a remote one replaces it for every package in that workspace, so the Mac build links these frameworks
# while the iOS build — which opens App.xcodeproj, never the Mac workspace — keeps the official binary, untouched.
#
# Safe to run again: it rebuilds only when the version changed or the frameworks are missing. The source is
# checked to be byte-for-byte the same as node_modules/@capacitor/ios before anything is built from it.
set -euo pipefail

HERE=${0:A:h}
REPO=${HERE:h:h:h:h}
NODE_CAP=$REPO/node_modules/@capacitor/ios
VERSION=$(node -p "require('$NODE_CAP/package.json').version")
OUT=$HERE/capacitor-swift-pm
WORK=$HERE/.build
SRC=$WORK/capacitor-$VERSION
STAMP=$OUT/.version

if [[ -f $STAMP && $(cat $STAMP) == $VERSION && -d $OUT/Capacitor.xcframework && -d $OUT/Cordova.xcframework ]]; then
  echo "Capacitor $VERSION for Mac Catalyst is already built."
  exit 0
fi

mkdir -p $WORK
if [[ ! -d $SRC ]]; then
  git clone --quiet --depth 1 --branch $VERSION https://github.com/ionic-team/capacitor.git $SRC
fi

# The same code the iOS app runs, or nothing is built.
diff -r $SRC/ios/Capacitor/Capacitor $NODE_CAP/Capacitor/Capacitor >/dev/null || { echo "Capacitor $VERSION source differs from node_modules" >&2; exit 2; }
diff -r $SRC/ios/CapacitorCordova/CapacitorCordova $NODE_CAP/CapacitorCordova/CapacitorCordova >/dev/null || { echo "Cordova $VERSION source differs from node_modules" >&2; exit 2; }

ARCHIVES=$WORK/archives-$VERSION
rm -rf $ARCHIVES
for SCHEME in Cordova Capacitor; do
  xcodebuild archive \
    -workspace $SRC/ios/Capacitor/Capacitor.xcworkspace \
    -scheme $SCHEME \
    -configuration Release \
    -destination 'generic/platform=macOS,variant=Mac Catalyst' \
    -archivePath $ARCHIVES/$SCHEME.xcarchive \
    -derivedDataPath $WORK/DerivedData \
    SKIP_INSTALL=NO BUILD_LIBRARY_FOR_DISTRIBUTION=YES CODE_SIGNING_ALLOWED=NO \
    -quiet
done

rm -rf $OUT/Capacitor.xcframework $OUT/Cordova.xcframework
for NAME in Cordova Capacitor; do
  FRAMEWORK=$(find $ARCHIVES/$NAME.xcarchive/Products -maxdepth 4 -name "$NAME.framework" -type d | head -1)
  [[ -n $FRAMEWORK ]] || { echo "No $NAME.framework in its archive" >&2; exit 3; }
  xcodebuild -create-xcframework -framework $FRAMEWORK -output $OUT/$NAME.xcframework >/dev/null
done
echo $VERSION > $STAMP
echo "Built Capacitor $VERSION for Mac Catalyst into $OUT"
