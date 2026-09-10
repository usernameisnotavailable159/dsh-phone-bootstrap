#!/data/data/com.termux/files/usr/bin/bash
export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin:$PATH
export PREFIX=/data/data/com.termux/files/usr
export TERMUX_LAUNCHER_MANAGE_RUNSVDIR=0
export TERMUX_LAUNCHER_PORT=45231
exec /data/data/com.termux/files/home/.local/bin/termux-launcher-agent --bootstrap
