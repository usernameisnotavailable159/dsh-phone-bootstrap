// verify-patch-drill.mjs — 重打演练：证明 patch-dsh-android-compat.mjs 能从「上游原版」重打，
// 且重复执行为幂等 no-op。
//
// 做法：用各补丁的 .bak-android-* 备份（=上游原始文件）在 mkdtemp 临时树里重建一个假 dshRoot，
// 让 patcher 在假树上跑，断言 changed=3；再跑一次，断言 changed=0。全程不触碰真实安装版。
//
// 用法: node verify/verify-patch-drill.mjs
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATCHER = join(HERE, '..', 'dsh-core', 'patch-dsh-android-compat.mjs');
const LIVE_ROOT = '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};

// 三处补丁的「上游原版来源」= 各自备份文件（备份永不覆盖，保留最初版）
const liveAi = join(LIVE_ROOT, 'node_modules', '@deepseek-ai');
const liveChunk = readdirSync(join(liveAi, 'dsh-subprocess-local', 'lib')).find(
  (f) => f.startsWith('runner-launch-') && f.endsWith('.js'),
);

const SOURCES = [
  {
    label: 'subprocess-local',
    bak: join(liveAi, 'dsh-subprocess-local', 'lib', `${liveChunk}.bak-android-fix`),
    rel: join('node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', liveChunk),
    marker: 'if (platform === "linux" || platform === "android") return new LinuxProcessInspector',
  },
  {
    label: 'terminal-bash',
    bak: join(liveAi, 'dsh-terminal-bash', 'lib', 'index.js.bak-android-shellpath'),
    rel: join('node_modules', '@deepseek-ai', 'dsh-terminal-bash', 'lib', 'index.js'),
    marker: 'process.platform === "android" && process.env.PREFIX',
  },
  {
    label: '@vscode/ripgrep',
    bak: join(LIVE_ROOT, 'node_modules', '@vscode', 'ripgrep', 'lib', 'index.js.bak-android-rgpath'),
    rel: join('node_modules', '@vscode', 'ripgrep', 'lib', 'index.js'),
    marker: 'android-compat-patch',
  },
];

check('D0 patcher 存在', existsSync(PATCHER), PATCHER);

let fakeRoot = null;
try {
  fakeRoot = mkdtempSync(join(tmpdir(), 'dsh-android-drill-'));
  console.log(`DRILL_ROOT=${fakeRoot}`);

  // 1) 用上游原版文件搭出假 dshRoot
  for (const src of SOURCES) {
    check(`D1 备份可用（${src.label}）`, existsSync(src.bak), src.bak.split('/').pop());
    if (!existsSync(src.bak)) continue;
    const dest = join(fakeRoot, src.rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src.bak, dest);
  }

  // 确认起点确为「未打补丁」
  for (const src of SOURCES) {
    const dest = join(fakeRoot, src.rel);
    if (!existsSync(dest)) continue;
    check(`D2 起点为未打补丁（${src.label}）`, !readFileSync(dest, 'utf8').includes(src.marker), 'marker absent');
  }

  // 2) 第一次重打：三处都应 APPLIED
  const run1 = execFileSync(process.execPath, [PATCHER, fakeRoot], { encoding: 'utf8' });
  const r1 = (run1.match(/RESULT changed=(\d+) failed=(\d+)/) ?? []).slice(1).join(',');
  check('D3 从上游原版重打成功', /RESULT changed=3 failed=0/.test(run1), `RESULT=${r1}`);
  for (const src of SOURCES) {
    const dest = join(fakeRoot, src.rel);
    if (!existsSync(dest)) continue;
    check(`D3b 补丁已落（${src.label}）`, readFileSync(dest, 'utf8').includes(src.marker), 'marker present');
  }

  // 3) 第二次重打：应全部幂等 no-op
  const run2 = execFileSync(process.execPath, [PATCHER, fakeRoot], { encoding: 'utf8' });
  const r2 = (run2.match(/RESULT changed=(\d+) failed=(\d+)/) ?? []).slice(1).join(',');
  check('D4 重复执行为幂等 no-op', /RESULT changed=0 failed=0/.test(run2), `RESULT=${r2}`);
  check('D4b 三次 [ok] already patched', (run2.match(/\[ok\] already patched/g) ?? []).length === 3, `count=${(run2.match(/\[ok\] already patched/g) ?? []).length}`);

  // 4) 演练树的写入未影响真实安装版（真实文件仍带 marker）
  for (const src of SOURCES) {
    const live = join(LIVE_ROOT, src.rel);
    if (!existsSync(live)) continue;
    check(`D5 真实安装版未受影响（${src.label}）`, readFileSync(live, 'utf8').includes(src.marker), 'live marker intact');
  }
} finally {
  if (fakeRoot) rmSync(fakeRoot, { recursive: true, force: true });
  check('D6 演练目录已清理', !fakeRoot || !existsSync(fakeRoot), fakeRoot ?? '');
}

console.log(`RESULT ${failed === 0 ? 'ALL_PASS' : 'FAILED:' + failed}`);
process.exit(failed === 0 ? 0 : 1);
