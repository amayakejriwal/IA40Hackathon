#!/bin/bash
# Build + install + launch on the USB iPhone. Uses -sdk iphoneos (no destination), which works
# without Xcode's 8 GB "iOS platform" simulator component.
set -euo pipefail
cd "$(dirname "$0")"
DEVICE=${DEVICE:-F4E1CD15-7ADB-5631-91E8-478D1C625D11}
xcodegen generate >/dev/null
xcodebuild -project FieldCapture.xcodeproj -target FieldCapture -sdk iphoneos -arch arm64 -configuration Debug \
  SYMROOT="$PWD/build/sdkbuild" -allowProvisioningUpdates build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | sort -u
xcrun devicectl device install app --device "$DEVICE" build/sdkbuild/Debug-iphoneos/FieldCapture.app | grep -iE "error|installed"
xcrun devicectl device process launch --terminate-existing --device "$DEVICE" sh.bluedoor.fieldcapture | tail -1
