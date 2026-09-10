#!/data/data/com.termux/files/usr/bin/bash
# Quarantine corrupt DSH Zstandard session logs before DSH web starts.
# DSH fails to boot with "corrupt Zstandard session log" if any .zstd file
# has a bad first frame. This script moves only files that fail `zstd -t`.
set -u
export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin:$PATH
SESSIONS="$HOME/.dsh/sessions"
CORRUPT_DIR="$HOME/.dsh/sessions-corrupt"
LOG="$HOME/logs/dsh-session-repair.log"
mkdir -p "$CORRUPT_DIR" "$HOME/logs"
echo "$(date '+%F %T') repair scan start" >> "$LOG"
[ -d "$SESSIONS" ] || { echo "$(date '+%F %T') no sessions dir, exit" >> "$LOG"; exit 0; }

count=0
while IFS= read -r -d '' f; do
  if ! /data/data/com.termux/files/usr/bin/zstd -t "$f" >/dev/null 2>&1; then
    ts=$(date '+%Y%m%d-%H%M%S')
    base=$(basename "$(dirname "$f")")-$(basename "$f")
    dest="$CORRUPT_DIR/${ts}-${base}"
    mv -f "$f" "$dest" 2>/dev/null && {
      echo "$(date '+%F %T') quarantined $f -> $dest" >> "$LOG"
      count=$((count+1))
    }
  fi
done < <(find "$SESSIONS" -type f -name '*.zstd' -print0)

echo "$(date '+%F %T') repair scan done, quarantined=$count" >> "$LOG"
exit 0
