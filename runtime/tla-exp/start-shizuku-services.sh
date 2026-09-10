#!/data/data/com.termux/files/usr/bin/bash
# Shizuku-hosted service supervisor (run inside Termux UID).
# Single-instance; starts/keeps alive:
#   - one termux-launcher-agent loop
#   - one Shizuku loop per external service in services.json
# It never kills unrelated healthy loops. A shell-uid watchdog
# (survival/shizuku/supervisor-watchdog.sh) restarts this supervisor if
# vivo/Android kills it.
set -u
export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin:$PATH
export PREFIX=/data/data/com.termux/files/usr
export TERMUX_LAUNCHER_MANAGE_RUNSVDIR=0
RISH=/data/data/com.termux/files/home/tools/shizuku/rish
T=/data/data/com.termux/files/home/tla-exp
LOCKDIR=$T/.locks
EXT="$HOME/.cache/termux-launcher/external"
LOG=/data/data/com.termux/files/home/logs/tla-shizuku-boot.log
mkdir -p /data/data/com.termux/files/home/logs "$LOCKDIR" "$EXT"

# Single-instance lock (mkdir is atomic).
# 重要：本脚本同时由 runsv 服务 `$PREFIX/var/service/termux-launcher` 常驻托管。
# 如果发现已有 supervisor 就 exit 0，runsv 会每秒重启本进程，日志刷屏 + 持续
# 唤醒 CPU（实测每 1s 一次）。正确做法是“热备等待”：持有锁的 supervisor 退出后，
# 当前实例再接管；期间进程保持存活，runsv 不会反复重启。
SUP_LOCK="$LOCKDIR/supervisor.lock"
while true; do
  if [ -f "$SUP_LOCK/pid" ]; then
    OLD_SUP=$(cat "$SUP_LOCK/pid" 2>/dev/null || true)
    if [ -n "$OLD_SUP" ] && kill -0 "$OLD_SUP" 2>/dev/null; then
      echo "$(date '+%F %T') supervisor already running pid=$OLD_SUP, standby" >> "$LOG"
      sleep 30
      continue
    fi
    rm -rf "$SUP_LOCK"
  fi
  if mkdir "$SUP_LOCK" 2>/dev/null; then
    break
  fi
  echo "$(date '+%F %T') cannot acquire supervisor lock, retry in 5s" >> "$LOG"
  sleep 5
done
echo $$ > "$SUP_LOCK/pid"
cleanup(){ rm -rf "$SUP_LOCK"; }
trap cleanup EXIT

# Quarantine any corrupt DSH session logs in the background so supervisor
# startup is not blocked by a long zstd scan.
if [ -x "$T/repair-dsh-sessions.sh" ]; then
  nohup bash "$T/repair-dsh-sessions.sh" >> "$LOG" 2>&1 &
fi

echo "$(date '+%F %T') supervisor start, waiting for Shizuku server" >> "$LOG"
while true; do
  if "$RISH" -c "id" >/dev/null 2>&1; then
    echo "$(date '+%F %T') Shizuku server ready" >> "$LOG"
    break
  fi
  sleep 5
done

start_loop(){
  local tag="$1" script="$2"
  local pidfile="$LOCKDIR/$tag.pid"
  if [ -f "$pidfile" ]; then
    local oldpid
    oldpid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
      echo "$(date '+%F %T') $tag loop already running pid=$oldpid" >> "$LOG"
      return 0
    fi
    rm -f "$pidfile"
  fi
  setsid "$RISH" -c "while true; do run-as com.termux $T/$script; sleep 2; done" </dev/null >/dev/null 2>&1 &
  echo $! > "$pidfile"
  echo "$(date '+%F %T') $tag loop started pid=$!" >> "$LOG"
}

agent_loop_alive(){
  local pidfile="$LOCKDIR/agent.pid"
  if [ -f "$pidfile" ]; then
    local oldpid
    oldpid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
      return 0
    fi
  fi
  local found
  found=$("$RISH" -c "pgrep -f '[r]un-agent-shizuku\\.sh'" 2>/dev/null)
  [ -n "$found" ]
}

service_loop_alive(){
  local id="$1"
  local pidfile="$EXT/$id.loop.pid"
  if [ -f "$pidfile" ]; then
    local oldpid
    oldpid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
      return 0
    fi
  fi
  local found
  found=$("$RISH" -c "pgrep -f '[r]un-service-shizuku\\.sh[[:space:]]+$id'" 2>/dev/null)
  [ -n "$found" ]
}

list_external_services(){
  python3 - "$HOME/.config/termux-launcher/services.json" <<'PY'
import json,sys
try:
    data=json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for s in data.get('services', []):
    if s.get('enabled', True) and s.get('supervisor') == 'external':
        print(s.get('id',''))
PY
}

ensure_agent(){
  if agent_loop_alive; then
    echo "$(date '+%F %T') agent loop already alive" >> "$LOG"
  else
    echo "$(date '+%F %T') agent loop missing, starting" >> "$LOG"
    start_loop agent run-agent-shizuku.sh
  fi
}

ensure_service(){
  local id="$1"
  if service_loop_alive "$id"; then
    return 0
  fi
  echo "$(date '+%F %T') external loop $id missing, starting" >> "$LOG"
  bash "$T/ensure-service-loop.sh" "$id" >> "$LOG" 2>&1 || echo "$(date '+%F %T') ensure $id failed ($?)" >> "$LOG"
}

# Initial ensure.
ensure_agent
for SVC in $(list_external_services); do
  ensure_service "$SVC"
done
echo "$(date '+%F %T') supervisor initial ensure done, entering monitor loop" >> "$LOG"

# Monitor loop.
while true; do
  sleep 15
  ensure_agent
  for SVC in $(list_external_services); do
    ensure_service "$SVC"
  done
done
