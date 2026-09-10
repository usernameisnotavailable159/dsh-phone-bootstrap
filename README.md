# dsh-phone-bootstrap

DSH Android/Termux 环境恢复包。适用于：

- 设备：vivo iQOO Z10 Turbo Pro / Android 16 / arm64-v8a
- Termux PREFIX：`/data/data/com.termux/files/usr`
- Node：v26.4.0
- DSH：`@deepseek-ai/dsh 0.1.5-rc.1`

本仓库保存 **DSH 本体补丁、profile 快照、自定义 agent presets、Shizuku/runsv 运行脚本和验证脚本**，用于重装 Termux、重建 DSH 环境或 DSH 升级后快速恢复。

## 目录

- `dsh-core/` — DSH 本体 Android/arm64 补丁脚本（可重复执行）
- `profile/` — DSH web profile 快照（插件清单、版本、bundle 顺序、锁文件）
- `presets/` — 自定义 agent presets
- `runtime/` — Shizuku supervisor、run-* 脚本、Termux Launcher `services.json`
- `verify/` — 无头 Chromium 验证脚本（需要先启动 DSH web 并拿到 token）

## 一键恢复脚本

仓库根目录的 `restore.sh` 可把 profile、presets、runtime 和 DSH 补丁脚本恢复到当前 Termux：

```sh
bash restore.sh --check   # 只打印将要复制/执行的内容
bash restore.sh --apply   # 备份现有文件后复制，并执行 dsh-core/apply-all.sh
```

已有文件会先备份到 `~/.dsh-backup-<时间戳>/`，脚本不会删除任何现有数据。

## 恢复顺序

1. 安装 Termux、Node 26、DSH `0.1.5-rc.1`，重建 web profile。
2. 按 `MANIFEST.md` 的“插件来源映射”把各插件仓库 clone 到对应路径（路径见 `profile/package.json`）。
3. 打 DSH 本体补丁（`apply-all.sh` 会把 patcher 复制到 `~/.dsh` 再执行两个脚本）：

   ```sh
   bash dsh-core/apply-all.sh
   ```

4. 把 `profile/` 中文件放回 `~/.dsh/profiles/web/`；路径是本机绝对路径，换设备需要调整。
5. 把 `presets/` 内容放回 `~/.dsh/.agent-presets/`。
6. 把 `runtime/tla-exp/` 放回 `~/tla-exp/`，`runtime/services.json` 放回 `~/.config/termux-launcher/`。
7. 启动 DSH web 后运行验证：

   ```sh
   node verify/verify-compat.mjs "<dsh-web-token>"
   # 或 verify/verify-merged.mjs / verify/verify-dsh-mobile.mjs
   #   无需 token 的 android 兼容体检（随时可跑）：
   node verify/verify-android-compat.mjs     # bash/PTY 链 + rg 链，18 项
   node verify/verify-patch-drill.mjs        # 重打演练（临时假树，不碰真实安装版）
   ```

   token 从启动日志 `dsh web: http://127.0.0.1:3080/?token=...` 获取。

## 重要提醒

- DSH 每次升级 / 重装后都要重跑 `dsh-core/` 中三个脚本，否则会遇到：
  - `ERR_FLOCK_UNSUPPORTED_PLATFORM`
  - `node-pty ... pty.node` 加载失败
  - `EACCES: permission denied, link ...`（runas_app + SELinux 硬链接拒绝）
  - `subprocess-local: terminal inspection is unsupported on platform android`（bash / PTY 工具整体不可用）
  - `ripgrep launch failed`（glob / grep 工具报错；上游 `@vscode/ripgrep` 无 android 平台包）
- 补丁生效需要**重启 DSH web**：终端后端与 rg 二进制路径都是按进程惰性记忆化的，运行中的进程会继续用旧值。
- 本仓库不包含任何凭证、DSH token、SSH key 或 signing key。
- `profile/`、`runtime/` 中路径是当前设备的 Termux 绝对路径。
