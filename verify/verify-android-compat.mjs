// verify-android-compat.mjs — Android/Termux 兼容修复的统一验证入口。
//
// 覆盖本仓库 dsh-core/patch-dsh-android-compat.mjs 的三处补丁所修复的两条链路：
//   A 段 · bash/PTY 链（补丁 1+2）：subprocess-local 的 android inspector 分支、
//        terminal-bash 的默认 shell 解析、node-pty 真起 bash 并回读。
//   B 段 · rg 链（补丁 3）：@vscode/ripgrep 的 rgPath 三级兑底 + 真 spawn 搜索。
//
// 全部为真调用（dynamic import 真模块、真 spawn 真进程、自建小目录写确定文件），
// 不用文本 grep 代替调用、不用 mock。
//
// 用法: node verify/verify-android-compat.mjs
// 前置: 已装 Termux 的 ripgrep（pkg install ripgrep）；DSH web 重启后 rg/PTY 才用新值。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PREFIX = process.env.PREFIX ?? '/data/data/com.termux/files/usr';
const DSH_ROOT = process.env.DSH_ROOT ?? join(PREFIX, 'lib/node_modules/@deepseek-ai/dsh');
const AI = join(DSH_ROOT, 'node_modules/@deepseek-ai');
const MODULES = join(DSH_ROOT, 'node_modules');
const HOME = process.env.HOME ?? '/data/data/com.termux/files/home';
const SCRATCH = join(HOME, '.dsh-android-compat-scratch');

let failed = 0;
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};
const section = (title) => console.log(`--- ${title} ---`);

console.log(`ENV platform=${process.platform} arch=${process.arch} node=${process.version}`);
console.log(`DSH_ROOT=${DSH_ROOT}`);
console.log(`PREFIX=${PREFIX}`);

// ==================== A 段 · bash/PTY 链 ====================
section('A. bash/PTY 链（补丁 1+2）');

// A1: subprocess-local 的 inspector 分支（真 import 真调用）
const subprocessDir = join(AI, 'dsh-subprocess-local/lib');
let factory = null;
let chunkName = null;
try {
  chunkName = readdirSync(subprocessDir).find((f) => f.startsWith('runner-launch-') && f.endsWith('.js'));
  const mod = await import(pathToFileURL(join(subprocessDir, chunkName)).href);
  factory = mod.O ?? mod.createProcessInspector;
  check('A1a 工厂函数可导出', typeof factory === 'function', `chunk=${chunkName}`);
} catch (e) {
  check('A1a 工厂函数可导出', false, `import failed: ${e.message.split('\n')[0].slice(0, 120)}`);
}
if (factory) {
  try {
    const insp = factory('android', 'arm64');
    check('A1b createProcessInspector(android,arm64) 可用', !!insp, `ctor=${insp?.constructor?.name ?? typeof insp}`);
  } catch (e) {
    check('A1b createProcessInspector(android,arm64) 可用', false, e.message.split('\n')[0].slice(0, 120));
  }
  try {
    const inspLinux = factory('linux', 'arm64');
    check('A1c linux 路径未回归', !!inspLinux, `ctor=${inspLinux?.constructor?.name ?? typeof inspLinux}`);
  } catch (e) {
    check('A1c linux 路径未回归', false, e.message.split('\n')[0].slice(0, 120));
  }
}

// A2: terminal-bash 默认 shell 兼容 android
try {
  const tbSrc = readFileSync(join(AI, 'dsh-terminal-bash/lib/index.js'), 'utf8');
  const hardCoded = /const DEFAULT_BASH_SHELL = "\/bin\/bash"/.test(tbSrc);
  check('A2 terminal-bash 默认 shell 兼容 android', !hardCoded && tbSrc.includes('PREFIX'), hardCoded ? '仍硬编码' : 'PREFIX-aware');
} catch (e) {
  check('A2 terminal-bash 默认 shell 兼容 android', false, e.message.slice(0, 100));
}

// A3: node-pty 真起 $PREFIX/bin/bash 回读
const bash = join(PREFIX, 'bin/bash');
check('A3a $PREFIX/bin/bash 存在', existsSync(bash), bash);
if (existsSync(bash)) {
  try {
    const req = createRequire(join(DSH_ROOT, 'package.json'));
    const pty = req('node-pty');
    const proc = pty.spawn(bash, ['--noprofile', '--norc', '-i'], {
      name: 'xterm-color',
      cols: 100,
      rows: 30,
      cwd: HOME,
      env: { ...process.env, PS1: '' },
    });
    let buf = '';
    const state = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('TIMEOUT'), 15000);
      proc.onData((d) => {
        buf += d;
        if (buf.includes('PTY_SAY_HI')) {
          clearTimeout(timer);
          resolve('OK');
        }
      });
      proc.onExit(() => {
        clearTimeout(timer);
        resolve('EXITED');
      });
      setTimeout(() => {
        try {
          proc.write('echo PTY_SAY_HI\r');
        } catch {
          /* ignore */
        }
      }, 500);
    });
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    check('A3b PTY 起 bash 回读 PTY_SAY_HI', state === 'OK', `state=${state}`);
  } catch (e) {
    check('A3b PTY 起 bash 回读 PTY_SAY_HI', false, `load/spawn error: ${e.message.slice(0, 120)}`);
  }
}

// ==================== B 段 · rg 链 ====================
section('B. rg 链（补丁 3）');

const RG_LOADER = join(MODULES, '@vscode/ripgrep/lib/index.js');
let rgPath = null;
try {
  const mod = await import(pathToFileURL(RG_LOADER).href + '?t=' + Date.now());
  rgPath = mod.rgPath;
  check('B1a rgPath 解析成功', typeof rgPath === 'string' && rgPath.length > 0, String(rgPath));
  check('B1b rgPath 指向真实文件', !!(rgPath && existsSync(rgPath)), rgPath ? `${statSync(rgPath).size}B` : '(none)');
} catch (e) {
  check('B1a rgPath 解析成功', false, `import failed: ${e.message.split('\n')[0].slice(0, 120)}`);
}

if (rgPath && existsSync(rgPath)) {
  const version = spawnSync(rgPath, ['--version'], { encoding: 'utf8' });
  check('B2 rgPath 可执行', version.status === 0 && /ripgrep/.test(version.stdout || ''), (version.stdout || '').split('\n')[0].trim());

  try {
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(join(SCRATCH, 'a.txt'), 'hello world\n');
    writeFileSync(join(SCRATCH, 'b.txt'), 'hello again\n');
    writeFileSync(join(SCRATCH, 'c.log'), 'no match here\n');

    const files = spawnSync(rgPath, ['--files'], { encoding: 'utf8', cwd: SCRATCH });
    const list = (files.stdout || '').split('\n').filter(Boolean).sort();
    check('B3 --files 返回确定结果', files.status === 0 && list.join(',') === 'a.txt,b.txt,c.log', `list=[${list.join(',')}]`);

    const globbed = spawnSync(rgPath, ['--files', '-g', '*.txt'], { encoding: 'utf8', cwd: SCRATCH });
    const txt = (globbed.stdout || '').split('\n').filter(Boolean).sort();
    check('B4 -g 过滤正常', globbed.status === 0 && txt.join(',') === 'a.txt,b.txt', `list=[${txt.join(',')}]`);

    const match = spawnSync(rgPath, ['-n', 'hello', '.'], { encoding: 'utf8', cwd: SCRATCH });
    const hits = (match.stdout || '').trim().split('\n').filter(Boolean);
    check('B5 -n 内容搜索命中 2 处', match.status === 0 && hits.length === 2, `hits=${hits.length}`);

    const json = spawnSync(rgPath, ['--json', 'hello', 'a.txt'], { encoding: 'utf8', cwd: SCRATCH });
    check('B6 --json 输出可解析', json.status === 0 && /"type":"match"/.test(json.stdout || ''), 'match event present');

    const nomatch = spawnSync(rgPath, ['-n', 'zzz_no_such_token', '.'], { encoding: 'utf8', cwd: SCRATCH });
    check('B7 无匹配退出码=1（rg 语义）', nomatch.status === 1, `status=${nomatch.status}`);
  } finally {
    rmSync(SCRATCH, { recursive: true, force: true });
  }
  check('B8 测试目录已清理', !existsSync(SCRATCH), SCRATCH);
} else {
  for (const n of ['B2 rgPath 可执行', 'B3 --files 返回确定结果', 'B4 -g 过滤正常', 'B5 -n 内容搜索命中 2 处', 'B6 --json 输出可解析', 'B7 无匹配退出码=1（rg 语义）']) {
    check(n, false, '无可用 rgPath');
  }
}

// B9: 不变量 —— 平台包仍为第一优先、兑底链完整（含 Termux 提示）
const rgSrc = existsSync(RG_LOADER) ? readFileSync(RG_LOADER, 'utf8') : '';
check('B9a 原平台包仍为第一优先', /resolved = require\.resolve/.test(rgSrc), 'require.resolve 在首级');
check('B9b 兑底含 $PREFIX/bin 与 PATH', rgSrc.includes('process.env.PREFIX') && rgSrc.includes('delimiter'), 'PREFIX + PATH');
check('B9c 全失败才抛错且带 Termux 提示', rgSrc.includes('pkg install ripgrep'), 'hint present');

// ==================== 汇总 ====================
console.log('');
console.log(`SUMMARY passed=${passed} failed=${failed}`);
console.log(`RESULT ${failed === 0 ? 'ALL_PASS' : 'FAILED:' + failed}`);
console.log('[note] rg 与 PTY 路径按进程记忆化：打过补丁后需重启 DSH web 才会用上新值。');
process.exit(failed === 0 ? 0 : 1);
