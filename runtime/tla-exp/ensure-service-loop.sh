#!/data/data/com.termux/files/usr/bin/bash
# 通用外部 Shizuku 监管循环确保器（Termux 用户态调用，内部用 rish 提权）。
# 用法: ensure-service-loop.sh <service-id>
# 职责:
#   1) 确保 run-service-shizuku.sh 包装存在
#   2) 按 services.json 生成 per-service 脚本 (~/.cache/termux-launcher/external/<id>.sh)
#   3) 若对应 Shizuku loop 未运行则启动之
set -u
export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin:$PATH
export PREFIX=/data/data/com.termux/files/usr

ID="${1:?usage: ensure-service-loop.sh <service-id>}"
CONFIG="$HOME/.config/termux-launcher/services.json"
RISH="$HOME/tools/shizuku/rish"
EXT="$HOME/.cache/termux-launcher/external"
WRAPPER="$HOME/tla-exp/run-service-shizuku.sh"
PIDFILE="$EXT/$ID.loop.pid"
mkdir -p "$EXT" "$HOME/tla-exp" "$HOME/.cache/termux-launcher/paused"

# 1) 通用包装
cat > "$WRAPPER" <<'WRAP'
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
WRAP
chmod 700 "$WRAPPER"

# 2) 生成 per-service 脚本
python3 - "$ID" "$CONFIG" "$EXT" <<'PY'
import json, os, sys
sid, cfg, ext = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(cfg))
svc = next((s for s in data.get('services', []) if s.get('id') == sid), None)
if svc is None:
    sys.exit(2)
if svc.get('supervisor') != 'external':
    sys.exit(3)
cwd = svc.get('cwd') or os.path.expanduser('~')
cmd = svc.get('command') or svc.get('startCommand') or ''
logs = svc.get('logs') or {}
out = logs.get('stdout') or os.path.expanduser('~/logs/launcher/.termux-launcher-%s.log' % sid)
def q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"
os.makedirs(os.path.dirname(out), exist_ok=True)
lines = [
    '#!/data/data/com.termux/files/usr/bin/bash',
    'export HOME=%s' % q(os.path.expanduser('~')),
    'export PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin:$PATH',
    'export PREFIX=/data/data/com.termux/files/usr',
    'cd %s || exit 1' % q(cwd),
    # 关键：从 Shizuku/rish 进程树下彻底脱离。浏览器面板等插件会让 DSH 启动
    # 超过 20s；若用 exec 让 run-as 一直等，部分 ROM/Shizuku 会在启动完成前
    # 回收该进程树，表现为“DSH 永远起不来”。setsid 后台化后 run-as 立即返回，
    # node 独立存活；loop 下一轮靠 start-web.sh 的幂等判断避免重复启动。
    'setsid bash -lc %s >> %s 2>&1 < /dev/null &' % (q(cmd), q(out)),
    'exit 0',
    '',
]
path = os.path.join(ext, sid + '.sh')
with open(path, 'w') as f:
    f.write('\n'.join(lines))
os.chmod(path, 0o700)
PY
[ $? -eq 0 ] || exit $?

# 2.5) 幂等去重：以 shell 侧 pgrep 为唯一事实源（Termux 用户看不到 shell uid 进程）。
# - 已有 1 个同 ID 循环：直接复用，避免 agent 每次 start/restart 都误判“缺失”后
#   杀旧起新，造成循环反复重建、服务被重复拉起（EADDRINUSE）。
# - 已有多个：保留最早/第一个，其余通过 rish 杀掉，修复历史遗留的重复循环。
# - 一个都没有：清掉 stale pidfile，下面启动唯一新循环。
service_loop_pids() {
  "$RISH" -c "pgrep -f '[r]un-service-shizuku\\.sh[[:space:]]+$ID'" 2>/dev/null
}
FOUND_LOOPS=$(service_loop_pids || true)
if [ -n "$FOUND_LOOPS" ]; then
  KEEP_PID=""
  for P in $FOUND_LOOPS; do
    if [ -z "$KEEP_PID" ]; then
      KEEP_PID="$P"
    else
      "$RISH" -c "kill -9 $P" >/dev/null 2>&1 || true
      echo "$(date '+%F %T') killed duplicate $ID loop pid=$P" >&2
    fi
  done
  echo "$KEEP_PID" > "$PIDFILE"
  chmod 600 "$PIDFILE" 2>/dev/null || true
  echo "$(date '+%F %T') $ID loop already alive pid=$KEEP_PID" >&2
  exit 0
fi
rm -f "$PIDFILE"

# 4) 启动 Shizuku loop（shell uid 父进程）
"$RISH" -c id >/dev/null 2>&1 || { echo "shizuku unavailable" >&2; exit 4; }
# 服务正常运行时 wrapper 会 exec 成 node，循环不会空转；只有以下两种情况会
# 快速返回 0：① start-web.sh 判定端口/进程已在运行（例如另一条重复 loop 或
# agent 已直接拉起）；② 服务被 pause。旧命令固定 sleep 2 会在这些情况下每 2 秒
# 唤醒一次 CPU，造成 Termux/Shizuku 常驻耗电。改为返回 0 时 sleep 30、异常退出
# 时 sleep 5，既保留自愈能力又显著降低空转。
setsid "$RISH" -c "while true; do run-as com.termux $WRAPPER $ID; rc=\$?; if [ \$rc -eq 0 ]; then sleep 30; else sleep 5; fi; done" </dev/null >/dev/null 2>&1 &
echo $! > "$PIDFILE"
chmod 600 "$PIDFILE" 2>/dev/null || true
exit 0
