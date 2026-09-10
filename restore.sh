#!/data/data/com.termux/files/usr/bin/bash
# Restore DSH Android/Termux bootstrap files into the current device.
#
# Usage:
#   bash restore.sh --check   # show what would be copied (default)
#   bash restore.sh --apply   # back up existing files, copy bootstrap files,
#                             # then run dsh-core/apply-all.sh
#
# This script never deletes user data. Existing files are backed up under
# ~/.dsh-backup-<timestamp>/ before being overwritten.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:---check}"
case "$MODE" in
  --check|--apply) ;;
  *) echo "usage: bash restore.sh [--check|--apply]" >&2; exit 2 ;;
esac
APPLY=0
[ "$MODE" = "--apply" ] && APPLY=1

# Termux HOME is normally /data/data/com.termux/files/home, but a bare
# `adb run-as`/non-login environment may report /data/user/0/com.termux.
# Prefer the canonical Termux home when it exists.
if [ -d /data/data/com.termux/files/home ]; then
  HOME_DIR=/data/data/com.termux/files/home
else
  HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
fi
DSH="$HOME_DIR/.dsh"
PROFILE="$DSH/profiles/web"
PRESETS="$DSH/.agent-presets"
RUNTIME="$HOME_DIR/tla-exp"
SERVICES="$HOME_DIR/.config/termux-launcher"
BACKUP="$HOME_DIR/.dsh-backup-$(date +%Y%m%d-%H%M%S)"

backup_path() {
  local target="$1" rel
  rel="${target#"$HOME_DIR"/}"
  mkdir -p "$BACKUP/$(dirname "$rel")"
  cp -a "$target" "$BACKUP/$rel"
}

install_file() {
  local src="$1" dest="$2"
  echo "[$MODE] file  $dest"
  if [ "$APPLY" = 1 ]; then
    mkdir -p "$(dirname "$dest")"
    [ -e "$dest" ] && backup_path "$dest"
    cp -a "$src" "$dest"
  fi
}

install_dir() {
  local src="$1" dest="$2"
  echo "[$MODE] dir   $dest/"
  if [ "$APPLY" = 1 ]; then
    mkdir -p "$dest"
    if [ -d "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null || true)" ]; then
      backup_path "$dest"
    fi
    cp -a "$src"/. "$dest"/
  fi
}

echo "== dsh-phone-bootstrap restore =="
echo "mode=$MODE home=$HOME_DIR"
[ "$APPLY" = 1 ] && echo "backup=$BACKUP"
echo

# 1) DSH core repair scripts -> ~/.dsh/
install_file "$DIR/dsh-core/apply-android-arm64-fixes.sh" "$DSH/apply-android-arm64-fixes.sh"
install_file "$DIR/dsh-core/patch-dsh-hardlinks.mjs" "$DSH/patch-dsh-hardlinks.mjs"
install_file "$DIR/dsh-core/apply-all.sh" "$DSH/apply-all-bootstrap.sh"

# 2) web profile snapshot -> ~/.dsh/profiles/web/
for f in package.json cordis.patch.yml cordis.yml pnpm-lock.yaml pnpm-workspace.yaml plugin-state.json; do
  [ -f "$DIR/profile/$f" ] && install_file "$DIR/profile/$f" "$PROFILE/$f"
done

# 3) agent presets -> ~/.dsh/.agent-presets/
if [ -d "$DIR/presets" ]; then
  for d in "$DIR"/presets/*/; do
    [ -d "$d" ] || continue
    install_dir "$d" "$PRESETS/$(basename "$d")"
  done
fi

# 4) runtime scripts -> ~/tla-exp/, services.json -> ~/.config/termux-launcher/
if [ -d "$DIR/runtime/tla-exp" ]; then
  for f in "$DIR"/runtime/tla-exp/*.sh; do
    [ -f "$f" ] && install_file "$f" "$RUNTIME/$(basename "$f")"
  done
fi
[ -f "$DIR/runtime/services.json" ] && install_file "$DIR/runtime/services.json" "$SERVICES/services.json"

echo
if [ "$APPLY" = 1 ]; then
  echo "== running DSH core android-arm64 fixes =="
  bash "$DSH/apply-all-bootstrap.sh"
  echo
  echo "[done] restore applied. Restart DSH web to load the restored code."
else
  echo "[check] no changes made. Re-run with: bash restore.sh --apply"
fi
