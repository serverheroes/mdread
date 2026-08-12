#!/bin/bash
# Builds ~/Applications/MDRead.app so double-clicking .md files opens mdread.
# Safe to re-run (e.g. after moving this folder or switching node versions).
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
APP="$HOME/Applications/MDRead.app"
PLIST="$APP/Contents/Info.plist"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [ -z "$NODE" ]; then
  echo "install-app: node not found in PATH" >&2
  exit 1
fi

mkdir -p "$HOME/Applications"
SCRIPT="$(mktemp -t mdread-launcher).applescript"
cat > "$SCRIPT" <<EOF
on open theFiles
	repeat with f in theFiles
		set p to POSIX path of f
		do shell script "nohup \"${NODE}\" \"${DIR}/index.js\" " & quoted form of p & " >/dev/null 2>&1 &"
	end repeat
end open

on run
	display dialog "MDRead opens Markdown files in a book-style reader." & return & return & "Double-click any .md file, or drop one on this icon." buttons {"OK"} default button 1 with title "MDRead"
end run
EOF

rm -rf "$APP"
osacompile -o "$APP" "$SCRIPT"
rm -f "$SCRIPT"

/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier local.mdread' "$PLIST" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string local.mdread' "$PLIST"

/usr/libexec/PlistBuddy \
  -c 'Add :CFBundleDocumentTypes:0 dict' \
  -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeName string "Markdown Document"' \
  -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer' \
  -c 'Add :CFBundleDocumentTypes:0:LSHandlerRank string Owner' \
  -c 'Add :CFBundleDocumentTypes:0:LSItemContentTypes array' \
  -c 'Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string net.daringfireball.markdown' \
  -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array' \
  -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string md' \
  -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:1 string markdown' \
  -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:2 string mdown' \
  -c 'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:3 string mkd' \
  "$PLIST"

# Drop the droplet's catch-all "*" document type so the app only claims markdown.
/usr/libexec/PlistBuddy -c 'Delete :CFBundleDocumentTypes:1' "$PLIST" 2>/dev/null || true

codesign --force --sign - "$APP"
"$LSREGISTER" -f "$APP"
echo "Built $APP"

if command -v duti >/dev/null 2>&1; then
  duti -s local.mdread net.daringfireball.markdown viewer
  echo "MDRead is now the default app for Markdown files."
else
  echo "To make MDRead the default: brew install duti && duti -s local.mdread net.daringfireball.markdown viewer"
  echo "(or: Get Info on a .md file → Open with → MDRead → Change All)"
fi
