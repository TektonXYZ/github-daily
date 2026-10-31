#!/bin/bash
# Installs the daily publish job on this Mac. Runs at noon, or on wake if it slept through noon.
# Stop it for a while: touch ~/github-daily/PAUSE
# Remove it: launchctl bootout gui/$(id -u)/com.tektonxyz.github-daily
set -e
label=com.tektonxyz.github-daily
plist="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/bin/node</string><string>$HOME/.claude/skills/github-daily/publish.mjs</string></array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>
<key>StandardOutPath</key><string>$HOME/github-daily/daily.log</string>
<key>StandardErrorPath</key><string>$HOME/github-daily/daily.log</string>
</dict></plist>
EOF
plutil -lint "$plist"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Daily job installed. It publishes one project a day at noon."
