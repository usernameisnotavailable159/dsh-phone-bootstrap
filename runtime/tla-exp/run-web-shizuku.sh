#!/data/data/com.termux/files/usr/bin/bash
export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin:$PATH
export PREFIX=/data/data/com.termux/files/usr
export TERMUX_LAUNCHER_MANAGE_RUNSVDIR=0
export TERMUX_LAUNCHER_PORT=45231

# Idle pause: agent 创建该文件后，loop 不应再拉起服务。
PAUSE_FILE="$HOME/.cache/termux-launcher/paused/harness"
if [ -f "$PAUSE_FILE" ]; then
  exit 0
fi
cd /data/data/com.termux/files/home/projects/deepseek-harness && exec /data/data/com.termux/files/usr/bin/bash start-web.sh
