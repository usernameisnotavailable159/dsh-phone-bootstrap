#!/data/data/com.termux/files/usr/bin/bash
# DSH Android/arm64 修复脚本（Termux）
#
# 背景：
#   1. npm 上没有 @deepseek-ai/node-addon-system-android-arm64，
#      DSH 的 session JSONL 写锁会抛 ERR_FLOCK_UNSUPPORTED_PLATFORM。
#   2. node-pty 的 Linux 安装不会生成 spawn-helper（binding.gyp 只给 mac 建），
#      且 profile 里 pnpm 安装的 node-pty 没有 android-arm64 预编译产物。
#
# 本脚本从包内自带源码现场编译 android-arm64 所需二进制，并给 flock 加载器打补丁。
# 可重复执行；已存在/已打补丁则跳过。
set -u
export PATH=/data/data/com.termux/files/usr/bin:$PATH
PREFIX=/data/data/com.termux/files/usr
DSH_ROOT=/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh
DSH_MODULES="$DSH_ROOT/node_modules/@deepseek-ai"
NAS="$DSH_MODULES/node-addon-system"
GLOBAL_PTY="$DSH_ROOT/node_modules/node-pty"
PROFILE_PTY=/data/data/com.termux/files/home/.dsh/profiles/web/node_modules/node-pty
NODE_GYP=/data/data/com.termux/files/usr/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js

# ---------- 1) flock Node-API addon ----------
if [ -f "$NAS/src/flock.c" ]; then
  mkdir -p "$NAS/prebuilds/android-arm64"
  if [ ! -f "$NAS/prebuilds/android-arm64/system.node" ]; then
    clang -shared -fPIC -I"$PREFIX/include/node" -o "$NAS/prebuilds/android-arm64/system.node" "$NAS/src/flock.c" && \
      echo "[fix] built flock addon"
  else
    echo "[ok] flock addon exists"
  fi
else
  echo "[warn] $NAS/src/flock.c missing; skip flock addon"
fi

# ---------- 2) flock.js 加载器补丁（android-arm64 指向本地编译产物） ----------
if [ -f "$NAS/lib/flock.js" ]; then
  if ! grep -q 'prebuilds/android-arm64' "$NAS/lib/flock.js"; then
    [ -f "$NAS/lib/flock.js.bak-android-arm64" ] || cp "$NAS/lib/flock.js" "$NAS/lib/flock.js.bak-android-arm64"
    node - "$NAS/lib/flock.js" <<'NODE'
const fs = require('node:fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("from 'node:url'")) {
  s = s.replace("import { getSystemErrorName } from 'node:util';", "import { getSystemErrorName } from 'node:util';\nimport { fileURLToPath } from 'node:url';");
}
const old = "    const { platform, arch } = process;\n    if (platform !== 'linux' && platform !== 'darwin') {\n";
const neu = "    const { platform, arch } = process;\n    // Android/Termux: no @deepseek-ai/node-addon-system-android-arm64 on npm.\n    if (platform === 'android' && arch === 'arm64') {\n        const local = fileURLToPath(new URL('../prebuilds/android-arm64/system.node', import.meta.url));\n        binding = createRequire(import.meta.url)(local);\n        return binding;\n    }\n    if (platform !== 'linux' && platform !== 'darwin') {\n";
if (!s.includes(old)) {
  console.error('[warn] flock.js anchor missing; not patched');
  process.exit(1);
}
fs.writeFileSync(p, s.replace(old, neu, 1));
console.log('[fix] patched flock.js for android-arm64');
NODE
  else
    echo "[ok] flock.js already patched"
  fi
fi

# ---------- 3) node-pty 原生模块 + spawn-helper ----------
build_pty() {
  local dir="$1"
  [ -d "$dir" ] || { echo "[skip] node-pty not found: $dir"; return 0; }
  if [ ! -f "$dir/build/Release/pty.node" ]; then
    echo "[fix] building node-pty native module: $dir"
    (cd "$dir" && timeout 300 node "$NODE_GYP" rebuild --nodedir="$PREFIX" --arch=arm64 --release) || \
      echo "[warn] node-gyp rebuild failed: $dir"
  else
    echo "[ok] node-pty pty.node exists: $dir"
  fi
  if [ -f "$dir/src/unix/spawn-helper.cc" ]; then
    if [ ! -f "$dir/build/Release/spawn-helper" ]; then
      clang++ -O2 -fstack-protector-strong -o "$dir/build/Release/spawn-helper" "$dir/src/unix/spawn-helper.cc" && \
        echo "[fix] built node-pty spawn-helper: $dir"
    else
      echo "[ok] node-pty spawn-helper exists: $dir"
    fi
    chmod 755 "$dir/build/Release/spawn-helper" 2>/dev/null || true
  fi
}
build_pty "$GLOBAL_PTY"
build_pty "$PROFILE_PTY"

# ---------- 4) session/文件写入的 hardlink 回退（runas_app 下 link 被 SELinux 拒绝） ----------
PATCHER="$HOME/.dsh/patch-dsh-hardlinks.mjs"
if [ -f "$PATCHER" ]; then
  node "$PATCHER" "$DSH_ROOT" || echo "[warn] hardlink fallback patch failed"
else
  echo "[warn] $PATCHER missing; skip hardlink fallback patches"
fi

echo "[done] DSH android-arm64 fixes applied. Restart DSH web to take effect."
