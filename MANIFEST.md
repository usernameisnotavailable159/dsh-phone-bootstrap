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

对应脚本：

- `dsh-core/apply-all.sh` — 一键入口（复制 patcher 后依次执行两个脚本）
- `dsh-core/apply-android-arm64-fixes.sh` — flock + node-pty
- `dsh-core/patch-dsh-hardlinks.mjs` — 三个包 hardlink 回退

## 插件来源映射

| profile 包名 | 来源 / 远端 | 当前分支与提交 |
|---|---|---|
| `dsh-pocket` | `git@github.com:usernameisnotavailable159/dsh-pocket.git` | `main @ 46f843c`（含 UPSTREAM.md） |
| `dsh-commandcode-go` | `git@github.com:usernameisnotavailable159/dsh-commandcode-go.git` | `main @ 1ee98b0`（含 provider passthrough 崩溃修复） |
| `@dsh-external/dsh-notify` | `git@github.com:usernameisnotavailable159/dsh-notify.git` | `master @ 1bc177a`（含 UPSTREAM.md） |
| `dsh-undo-snapshot`（仓库名 dsh-undo-redo） | `git@github.com:usernameisnotavailable159/dsh-undo-redo.git` | `main @ 1eaae2a`（含 UPSTREAM.md） |
| `dsh-memory-evolve` | `git@github.com:usernameisnotavailable159/dsh-memory-evolve.git`（origin 上游 `dsh-external/dsh-memory-evolve`） | 上游 `main @ b4994fa`；本地 `phone-local-20260911 @ 7f1f879`（minify 构建）；备份 tag `phone-local-20260911-pre-rebase @ 786cc0c` |
| `dsh-agi-harness` plugins（browser-panel / closedloop / engram） | `git@github.com:usernameisnotavailable159/dsh-agi-harness.git`（origin 上游 `yjh051108/dsh-agi-harness`） | `main`/`compat-fixes @ 08ef33a`；`upstream-main @ 0a17d30` |
| `dsh-phone-bootstrap` | `git@github.com:usernameisnotavailable159/dsh-phone-bootstrap.git` | `main @ 5256491`（restore.sh / apply-all.sh / profile 快照 / presets / runtime） |
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

## 安全

本仓库明确不包含：

- `~/.dsh/.credentials.yaml`、`~/.dsh/.env`、`~/.dsh/settings.yaml` 中的任何凭证
- DSH web token、Termux Launcher token、SSH key、signing key
