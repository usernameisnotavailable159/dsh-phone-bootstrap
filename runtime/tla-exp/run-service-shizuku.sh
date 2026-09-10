#!/data/data/com.termux/files/usr/bin/bash
export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin:$PATH
export PREFIX=/data/data/com.termux/files/usr
ID="$1"
[ -n "$ID" ] || exit 0
PAUSE="$HOME/.cache/termux-launcher/paused/$ID"
[ -f "$PAUSE" ] && exit 0
SERVICE_SCRIPT="$HOME/.cache/termux-launcher/external/$ID.sh"
[ -f "$SERVICE_SCRIPT" ] || exit 0
exec bash "$SERVICE_SCRIPT"
