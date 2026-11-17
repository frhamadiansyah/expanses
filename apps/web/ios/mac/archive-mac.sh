#!/bin/zsh
#
# The Mac app's store build: archive (Release, Mac Catalyst) and export the signed .pkg for App Store Connect.
# Uploading is a separate step (xcrun altool --upload-app -t macos), so a failure is attributable to one thing.
#
#   ios/mac/archive-mac.sh <build number> <marketing version>
#   → ios/App/build/App-mac.xcarchive and ios/App/build/export-mac/cicis.pkg
#
# Why the archive is not signed by Xcode: with automatic signing an archive is first signed for development, and a
# Mac development profile needs this Mac registered as a device on the team. The store build needs no device. So the
# archive is built unsigned, signed here ad hoc with the Mac entitlements (App/App.mac.entitlements, hardened
# runtime), and the export re-signs it for the store with the App Store Connect API key — Xcode's cloud-managed Apple
# Distribution certificate and a Mac Catalyst App Store profile, created by -allowProvisioningUpdates when missing.
# The export reads the entitlements from that ad hoc signature, so they are the ones in App/App.mac.entitlements.
#
# Run `npm run cap:sync` (plain, never CICIS_INSPECTABLE for the store) in apps/web first.
set -euo pipefail

N=${1:?build number}
V=${2:?marketing version}
HERE=${0:A:h}
cd ${HERE:h}/App
KEY_ID=${ASC_KEY_ID:-4CBAJ27SR6}
ISSUER=${ASC_ISSUER:-800b81f4-e9b0-4b77-a9a8-dee6c6e49d82}
AUTH=(-allowProvisioningUpdates -authenticationKeyPath $HOME/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8 -authenticationKeyID $KEY_ID -authenticationKeyIssuerID $ISSUER)

# Never a development bundle (mac/run-local-sample.sh leaves one with the sample household in App/public).
if grep -rq 'Loading sample data' App/public; then echo "App/public holds a development bundle: run npm run cap:sync first" >&2; exit 4; fi
$HERE/build-capacitor-catalyst.sh
rm -rf build/App-mac.xcarchive build/export-mac
xcodebuild archive -workspace Mac.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=macOS,variant=Mac Catalyst' -archivePath build/App-mac.xcarchive \
  MARKETING_VERSION=$V CURRENT_PROJECT_VERSION=$N CODE_SIGNING_ALLOWED=NO -quiet

APP=build/App-mac.xcarchive/Products/Applications/cicis.app
for FRAMEWORK in $APP/Contents/Frameworks/*.framework; do codesign --force --sign - --timestamp=none $FRAMEWORK; done
codesign --force --sign - --options runtime --timestamp=none --entitlements App/App.mac.entitlements $APP

# What must and must not be in the Mac app.
ENT=$(codesign -d --entitlements :- $APP 2>/dev/null)
echo $ENT | grep -q com.apple.security.app-sandbox || { echo "no sandbox" >&2; exit 5; }
echo $ENT | grep -q iCloud.com.cicis.app || { echo "no iCloud container" >&2; exit 6; }
if echo $ENT | grep -q nfc.readersession; then echo "NFC entitlement in the Mac app" >&2; exit 7; fi
if [[ -d $APP/Contents/PlugIns ]]; then echo "an extension is in the Mac app" >&2; exit 8; fi
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' $APP/Contents/Info.plist) == com.cicis.app ]] || { echo "bundle id is not com.cicis.app" >&2; exit 9; }
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' $APP/Contents/Info.plist) == $N ]] || { echo "build number is not $N" >&2; exit 10; }

xcodebuild -exportArchive -archivePath build/App-mac.xcarchive -exportPath build/export-mac \
  -exportOptionsPlist ../ExportOptions.plist "${AUTH[@]}" -quiet
PKG=build/export-mac/cicis.pkg
pkgutil --check-signature $PKG | head -3
echo "Exported ${PWD}/$PKG"
