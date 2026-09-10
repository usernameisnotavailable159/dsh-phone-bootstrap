#!/system/bin/sh
# Shell-uid watchdog: keeps the Termux-user Shizuku supervisor alive.
# Because the supervisor itself runs as com.termux (u0_a289), vivo may kill it;
# this watchdog runs as shell uid through Shizuku and restarts it.
# It also performs the old app-level checks (Termux / TermuxLauncher / Shizuku).
LOG=/data/local/tmp/tla-supervisor-watchdog.log
log(){ echo "$(date '+%F %T') $*" >> "$LOG"; }

SUPERVISOR_PATTERN='start-shizuku-services\.sh'

supervisor_alive(){
  pgrep -f "$SUPERVISOR_PATTERN" >/dev/null 2>&1
}

start_supervisor(){
  log "supervisor missing, starting"
  # run-as com.termux keeps the process in Termux UID so it can write home files.
  nohup sh -c 'run-as com.termux /data/data/com.termux/files/usr/bin/bash /data/data/com.termux/files/home/tla-exp/start-shizuku-services.sh' \
    </dev/null >/dev/null 2>&1 &
}

restart_launcher(){
  log "restarting termuxlauncher"
  am start -n com.example.termuxlauncher/.MainActivity >>"$LOG" 2>&1
}

restart_termux_activity(){
  log "restarting termux activity"
  am start -n com.termux/.app.TermuxActivity >>"$LOG" 2>&1
}

restart_shizuku(){
  log "restarting shizuku app"
  am start -n moe.shizuku.privileged.api/moe.shizuku.manager.MainActivity >>"$LOG" 2>&1
}

while true; do
  sleep 15
  if ! supervisor_alive; then
    start_supervisor
  fi
  if ! ps -A -o PID,ARGS | grep -q 'moe\.shizuku\.privileged\.api$'; then
    log "shizuku app missing"
    restart_shizuku
  fi
  sleep 3
  if ! ps -A -o PID,ARGS | grep -q 'com\.termux$'; then
    log "termux process missing"
    restart_termux_activity
  fi
  sleep 3
  if ! ps -A -o PID,ARGS | grep -q 'com\.example\.termuxlauncher$'; then
    log "launcher process missing"
    restart_launcher
  fi
done
