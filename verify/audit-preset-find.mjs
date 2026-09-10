// audit-preset-find.mjs — 审计 router-spec preset 全部 .find( 调用，定位唯一可触发点
//
// 判定口径：每处给出「文件:行 + 完整表达式 + 接收者 + 接收者构造方式 + 能否为 undefined + 是否可达」
// 目的：在 router-spec preset 中找出能产生 "Cannot read properties of undefined (reading 'find')" 的位置。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '/data/data/com.termux/files/home/.dsh/.agent-presets/router-spec';

/** 逐处判定表：接收者构造方式是人工从源码读出后记录（附源码行号，可复核）
 *  注：router-bootstrap.mjs 与 router-bootstrap-v1.mjs 是同一份内容的两副本
 *  （md5 相同，实测 f3ae2a760ba0dd1d38e19de6a5b530df），故同样 4 处 .find 同样 safe。
 */
const SAFE_BOOTSTRAP = [
  {
    line: 88,
    code: 'const planSection = (assembled.sections || []).find((s) => /plan/i.test(s.name))',
    receiver: '(assembled.sections || [])',
    construction: '带 `|| []` 守卫，恒为数组',
    why: '守卫保证非 undefined',
  },
  {
    line: 145,
    code: '[...agents.values()].find((a) => a.session === session)',
    receiver: '[...agents.values()]',
    construction: 'Map.values() 展开为数组字面量',
    why: '数组字面量恒为数组',
  },
  {
    line: 237,
    code: '[...agents.values()].find((a) => a.session === session)',
    receiver: '[...agents.values()]',
    construction: 'Map.values() 展开（调用前有 session === undefined 三元守卫）',
    why: '数组字面量恒为数组',
  },
  {
    line: 275,
    code: '[...agents.values()].find((a) => a.session === session)',
    receiver: '[...agents.values()]',
    construction: 'Map.values() 展开（currentAgent()，调用前有 session === undefined 守卫）',
    why: '数组字面量恒为数组',
  },
];

const ANALYSIS = [
  {
    file: 'router-core.mjs',
    line: 162,
    code: 'const userMsg = events.find((e) => e.type === \'user/message\')',
    receiver: 'events',
    construction: '三级取法：Array.isArray(session?.events) ? session.events : (typeof session?.snapshotEvents === "function" ? session.snapshotEvents() : [])  ← 已修复为恒为数组',
    canBeUndefined: false,
    reachable: false,
    why: '原实现直读 session.events（官方 Session 类无该成员→恒 undefined，已实测复现崩溃）；现已加三级兵法与 session 空值保护，故不再可触发',
    verdict: 'FIXED（原为 TRIGGERABLE，现已有守卫）',
  },
  ...SAFE_BOOTSTRAP.map((s) => ({
    ...s,
    file: 'router-bootstrap.mjs',
    canBeUndefined: false,
    reachable: false,
    verdict: 'safe',
  })),
  ...SAFE_BOOTSTRAP.map((s) => ({
    ...s,
    file: 'router-bootstrap-v1.mjs',
    canBeUndefined: false,
    reachable: false,
    verdict: 'safe',
  })),
];

let totalFound = 0;
let triggerable = 0;

console.log(`PRESET_DIR=${DIR}`);
console.log('');

// 实测：重新扫描目录，核对 ANALYSIS 是否与磁盘一致（防手工表漂移）
// 注意：需排除注释行——注释里引用 `events.find(...)` 字样不是真实调用
// （本单踩过：加注释后 grep 计数从 9 变 10，实为注释误计）。
const stripComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : line;
};
const jsFiles = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.mjs')) : [];
const diskFind = [];
for (const f of jsFiles) {
  const src = readFileSync(join(DIR, f), 'utf8');
  src.split('\n').forEach((l, i) => {
    const code = stripComment(l);
    if (/\.find\s*\(/.test(code)) diskFind.push({ file: f, line: i + 1, code: code.trim() });
  });
}
totalFound = diskFind.length;
console.log(`DISK_FIND_CALLS=${totalFound}`);
for (const d of diskFind) {
  console.log(`  ${d.file}:${d.line}  ${d.code.slice(0, 120)}`);
}
console.log('');

console.log('=== 逐处判定 ===');
for (const a of ANALYSIS) {
  const isTriggerable = a.canBeUndefined && a.reachable;
  if (isTriggerable) triggerable += 1;
  console.log('');
  console.log(`${a.file}:${a.line}  [${a.verdict}]`);
  console.log(`  CODE:        ${a.code}`);
  console.log(`  RECEIVER:    ${a.receiver}`);
  console.log(`  CONSTRUCTED: ${a.construction}`);
  console.log(`  CAN_UNDEF:   ${a.canBeUndefined}`);
  console.log(`  REACHABLE:   ${a.reachable}`);
  console.log(`  WHY:         ${a.why}`);
}

// 一致性核对：磁盘上的 .find 数应与判定表覆盖的一致
console.log('');
const covered = new Set(ANALYSIS.map((a) => `${a.file}:${a.line}`));
const diskSet = new Set(diskFind.map((d) => `${d.file}:${d.line}`));
const missing = [...diskSet].filter((k) => !covered.has(k));
console.log(`ANALYSIS_COVERS=${covered.size}  DISK=${diskSet.size}  UNCOVERED=${missing.length}`);
if (missing.length) console.log(`  UNCOVERED_ITEMS=${missing.join(', ')}`);

console.log('');
console.log(`=== 调用链与触发条件 ===`);
console.log('router-bootstrap.mjs 三处调用点均写作:');
console.log('    overrides.get(session.id) ?? firstUserText.get(session.id) ?? sessionMode(session)');
console.log('  → ?? 短路：仅当前两者都为 undefined 时才走到 sessionMode(session)');
console.log('  → overrides 由 dev_router_mode 工具写入；firstUserText 由 session/event 监听器在首条 user 文本时填充');
console.log('  → 因此平时不崩（首轮即被 firstUserText 拦截）；而本次事件序列里出现了绕过该拦截的路径');

console.log('');
console.log(`RESULT total_find=${totalFound} triggerable=${triggerable} fixed_site=router-core.mjs:162`);
process.exit(missing.length === 0 ? 0 : 1);
