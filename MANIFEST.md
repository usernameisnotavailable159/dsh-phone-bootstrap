# MANIFEST

## 基线

| 项 | 值 |
|---|---|
| 设备 | vivo iQOO Z10 Turbo Pro |
| Android | 16 / API 36 |
| ABI | arm64-v8a |
| Termux PREFIX | `/data/data/com.termux/files/usr` |
| Node | v26.4.0 |
| DSH | `@deepseek-ai/dsh 0.1.5-rc.1` |

## 恢复入口

- `restore.sh --check` / `restore.sh --apply` — 把本仓库的 profile/presets/runtime/DSH 补丁恢复回当前 Termux

## DSH 本体补丁（不在 npm / git 中）

| 包 | 补丁内容 | 备份 |
|---|---|---|
| `@deepseek-ai/node-addon-system` | 编译 `prebuilds/android-arm64/system.node`；`lib/flock.js` 增加 android-arm64 本地绑定分支 | `lib/flock.js.bak-20260910-android-arm64` |
| `node-pty`（全局） | `build/Release/pty.node`（node-gyp arm64）+ `build/Release/spawn-helper` | 原生构建产物 |
| `node-pty`（profile 副本） | 同上 | 原生构建产物 |
| `@deepseek-ai/dsh-session-persistence-jsonl` | `linkOrRename` 回退（EACCES/EPERM -> rename） | `lib/index.js.bak-android-link`、`lib/worker.cjs.bak-android-link` |
| `@deepseek-ai/dsh-attachment-local` | `linkOrCopyExclusive` 回退（EACCES/EPERM -> copy） | `lib/index.js.bak-android-link` |
| `@deepseek-ai/dsh-fs-local` | `linkFile` 回退（link 失败 -> copy） | `lib/index.js.bak-android-link` |
| `@deepseek-ai/dsh-subprocess-local` | `createProcessInspector` 的 linux 分支扩为 `(linux \|\| android)`；android/arm64 与 linux 同 ABI，复用 `LinuxProcessInspector`。0.1.5-rc.* 起该函数被抽到 `lib/runner-launch-*.js`（哈希文件名，脚本按前缀发现） | `lib/runner-launch-*.js.bak-android-fix` |
| `@deepseek-ai/dsh-terminal-bash` | bash dialect 默认 `shellPath` 在 android 下取 `$PREFIX/bin/bash`（Termux 无 `/bin/bash`）；非 android 仍为 `/bin/bash` | `lib/index.js.bak-android-shellpath` |
| `@vscode/ripgrep` | `rgPath` 三级兑底：平台包（原逻辑，第一优先）→ `$PREFIX/bin/rg` → PATH 上的 `rg`；全失败才抛错并提示 `pkg install ripgrep`。上游 `optionalDependencies` 12 个平台条目中无 android，故平台包解析必抛 `MODULE_NOT_FOUND` | `lib/index.js.bak-android-rgpath` |

对应脚本：

- `dsh-core/apply-all.sh` — 一键入口（复制 patcher 后依次执行三个脚本）
- `dsh-core/apply-android-arm64-fixes.sh` — flock + node-pty
- `dsh-core/patch-dsh-hardlinks.mjs` — 三个包 hardlink 回退
- `dsh-core/patch-dsh-android-compat.mjs` — subprocess-local + terminal-bash + `@vscode/ripgrep` 的 android 兼容

## 插件来源映射

| profile 包名 | 来源 / 远端 | 当前分支与提交 |
|---|---|---|
| `dsh-pocket` | `git@github.com:usernameisnotavailable159/dsh-pocket.git` | `main @ 46f843c`（含 UPSTREAM.md） |
| `dsh-commandcode-go` | `git@github.com:usernameisnotavailable159/dsh-commandcode-go.git` | `main @ 1ee98b0`（含 provider passthrough 崩溃修复） |
| `@dsh-external/dsh-notify` | `git@github.com:usernameisnotavailable159/dsh-notify.git` | `master @ 1bc177a`（含 UPSTREAM.md） |
| `dsh-undo-snapshot`（仓库名 dsh-undo-redo） | `git@github.com:usernameisnotavailable159/dsh-undo-redo.git` | `main @ 1eaae2a`（含 UPSTREAM.md） |
| `dsh-memory-evolve` | `git@github.com:usernameisnotavailable159/dsh-memory-evolve.git`（origin 上游 `dsh-external/dsh-memory-evolve`） | 上游 `main @ b4994fa`；本地 `phone-local-20260911 @ 7f1f879`（minify 构建）；备份 tag `phone-local-20260911-pre-rebase @ 786cc0c` |
| `dsh-agi-harness` plugins（browser-panel / closedloop / engram） | `git@github.com:usernameisnotavailable159/dsh-agi-harness.git`（origin 上游 `yjh051108/dsh-agi-harness`） | `main`/`compat-fixes @ 08ef33a`；`upstream-main @ 0a17d30` |
| `dsh-better-sidebar` | npm registry | `0.18.0-alpha.0` |
| `@linxin666/dsh-client-ui-task-board` | npm registry | `0.3.12` |
| `@liustack/modsearch` | npm registry | `5.10.0` |
| `dshmarket` | npm registry | `1.40.0` |
| `@deepseek-ai/dsh-settings` | npm registry | `0.1.1-rc.2` |

## profile 快照

- `profile/package.json` — 当前 web profile 依赖与 bundle 顺序
- `profile/cordis.patch.yml` — 插件启用/禁用补丁
- `profile/cordis.yml` — profile 根 entry 列表（当前为空 `[]`）
- `profile/pnpm-lock.yaml` — 依赖锁
- `profile/pnpm-workspace.yaml`
- `profile/plugin-state.json` — DSH WebUI 插件开关状态

## runtime 脚本

`runtime/tla-exp/` 包含 Shizuku-hosted supervisor 与 run-* 脚本：

- `start-shizuku-services.sh` — 单实例 supervisor，拉起 agent/harness 外部服务并监控
- `run-agent-shizuku.sh` / `run-web-shizuku.sh` / `run-service-shizuku.sh`
- `ensure-service-loop.sh`、`supervisor-watchdog.sh`、`repair-dsh-sessions.sh`
- `marker.sh`、`launch-*.sh`

`runtime/services.json` 当前服务定义：`harness`（DSH web, port 3080）、`chat-engine`（port 9876）、`test-echo`（disabled）。

## 验证脚本

- `verify/verify-compat.mjs` — 设置面板/会话 tabs/官方 stats/composer/A 方案右侧栏综合验证
- `verify/verify-dsh-mobile.mjs` — 较早期移动端验证（保留）
- `verify/verify-merged.mjs` — DSH 重启/合并后全链路验证（Command Code Go + dsh-pocket A 方案）
- `verify/verify-overflow-swipe.mjs` — 宽消息横向溢出场景：侧栏滑动仍可用；表格等真实横向控件保留原生横滑
- `verify/verify-android-compat.mjs` — android 兼容统一入口：A 段 bash/PTY 链（android inspector 分支 + 默认 shell + node-pty 真起 bash 回读）、B 段 rg 链（rgPath 兑底 + 真 spawn 验 `--files`/`-g`/`-n`/`--json`/退出码语义）与兑底链不变量。无 token 依赖，随时可跑
- `verify/verify-patch-drill.mjs` — 重打演练：用 `.bak-android-*` 备份在临时假树重建「上游原版」，断言 `patch-dsh-android-compat.mjs` 可从零重打（changed=3）且重复执行为幂等（changed=0），并断言真实安装版未被波及

## 安全

本仓库明确不包含：

- `~/.dsh/.credentials.yaml`、`~/.dsh/.env`、`~/.dsh/settings.yaml` 中的任何凭证
- DSH web token、Termux Launcher token、SSH key、signing key
