#!/usr/bin/env bash
set -euo pipefail

MACOS_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="${APP_NAME:-多AI中枢}"
APP_BUNDLE="${MACOS_DIR}/${APP_NAME}.app"
CONTENTS_DIR="${APP_BUNDLE}/Contents"
BIN_DIR="${CONTENTS_DIR}/MacOS"
RES_DIR="${CONTENTS_DIR}/Resources"
SERVER_SCRIPT="${MACOS_DIR}/server.mjs"

mkdir -p "${BIN_DIR}" "${RES_DIR}"
chmod +x "${SERVER_SCRIPT}"

cat > "${CONTENTS_DIR}/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.ai-hub.menubar</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>AIHubMenuBar</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
  <key>AIHubServerScript</key>
  <string>${SERVER_SCRIPT}</string>
</dict>
</plist>
EOF

echo "正在编译原生 macOS 菜单栏面板 ${APP_NAME}.app ..."
swiftc -O \
  -framework Cocoa \
  -framework WebKit \
  -framework Carbon \
  "${MACOS_DIR}/MenuBarApp.swift" \
  -o "${BIN_DIR}/AIHubMenuBar"

codesign --force --deep --sign - "${APP_BUNDLE}" >/dev/null 2>&1 || true

echo "✅ 编译完成：${APP_BUNDLE}"
