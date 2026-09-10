#!/data/data/com.termux/files/usr/bin/bash
# Self-contained DSH Android/arm64 fix entrypoint.
# Copies the hardlink patcher to ~/.dsh (the arm64 script expects it there),
# then runs the idempotent arm64 script.
set -euo pipefail
export PATH=/data/data/com.termux/files/usr/bin:$PATH
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.dsh"
cp "$DIR/patch-dsh-hardlinks.mjs" "$HOME/.dsh/patch-dsh-hardlinks.mjs"
bash "$DIR/apply-android-arm64-fixes.sh"
node "$HOME/.dsh/patch-dsh-hardlinks.mjs"
echo "[bootstrap] DSH android-arm64 fixes applied; restart DSH web to take effect."
