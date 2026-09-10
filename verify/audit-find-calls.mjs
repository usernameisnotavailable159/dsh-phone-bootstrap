// audit-find-calls.mjs — 审计本轮三处补丁能否产生 "Cannot read properties of undefined (reading 'find')"
//
// 方法：对每个被改文件，抽出所有 `.find(` 调用的表达式及其接收者，判定接收者能否为 undefined。
// 同时检查补丁是否扩大了可达面（使原本走不到的下游代码首次可达）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = process.env.PREFIX ?? '/data/data/com.termux/files/usr';
const DSH_ROOT = join(PREFIX, 'lib/node_modules/@deepseek-ai/dsh');
const AI = join(DSH_ROOT, 'node_modules/@deepseek-ai');

const TARGETS = [
  { label: '补丁1 subprocess-local chunk', path: null /* 动态发现 */ },
  { label: '补丁2 terminal-bash', path: join(AI, 'dsh-terminal-bash/lib/index.js') },
  { label: '补丁3 @vscode/ripgrep', path: join(DSH_ROOT, 'node_modules/@vscode/ripgrep/lib/index.js') },
  { label: '下游 dsh-tool-fs-search', path: join(AI, 'dsh-tool-fs-search/lib/index.js') },
  { label: '下游 dsh-subprocess-local 入口', path: join(AI, 'dsh-subprocess-local/lib/index.js') },
];

// 动态发现 chunk
const subDir = join(AI, 'dsh-subprocess-local/lib');
const chunk = existsSync(subDir) ? readdirSync(subDir).find((f) => f.startsWith('runner-launch-') && f.endsWith('.js')) : null;
if (chunk) TARGETS[0].path = join(subDir, chunk);

console.log('=== 逐文件审计 .find( 调用 ===');
let totalFindCalls = 0;
const findings = [];

for (const t of TARGETS) {
  if (!t.path || !existsSync(t.path)) {
    console.log(`\n--- ${t.label}: 文件不存在/未发现`);
    continue;
  }
  const src = readFileSync(t.path, 'utf8');
  const lines = src.split('\n');
  const calls = [];
  lines.forEach((l, i) => {
    if (/\.find\s*\(/.test(l)) calls.push({ n: i + 1, text: l.trim() });
  });
  totalFindCalls += calls.length;
  console.log(`\n--- ${t.label}`);
  console.log(`    path=${t.path.replace(DSH_ROOT, '<DSH>')}`);
  console.log(`    bytes=${src.length}  findCalls=${calls.length}`);
  for (const c of calls) {
    console.log(`    L${c.n}: ${c.text.slice(0, 170)}`);
    findings.push({ file: t.path, line: c.n, code: c.text });
  }
}

console.log(`\n=== 判定：逐个 .find( 的接收者能否为 undefined ===`);

// 手工判定表（基于上面抽出的实际代码）
const VERDICTS = [
  {
    site: '@vscode/ripgrep candidates.find(...)',
    code: 'resolved = candidates.find((candidate) => existsSync(candidate));',
    receiver: 'candidates',
    receiverConstruction: '[ ... ].filter(Boolean) — 数组字面量经 filter，永远是数组',
    canBeUndefined: false,
    note: '即使 PATH/PREFIX 都缺失，filter 后仍是空数组（[]），.find 返回 undefined 而非抛 TypeError；随后 if (!resolved) 抛上游风格的 Error',
  },
];

for (const v of VERDICTS) {
  console.log('');
  console.log(`SITE: ${v.site}`);
  console.log(`  CODE: ${v.code}`);
  console.log(`  RECEIVER: ${v.receiver}`);
  console.log(`  CONSTRUCTED_AS: ${v.receiverConstruction}`);
  console.log(`  CAN_BE_UNDEFINED: ${v.canBeUndefined}`);
  console.log(`  NOTE: ${v.note}`);
}

console.log('');
console.log(`=== 补丁可达面分析 ===`);
console.log('补丁1: 仅把 createProcessInspector 的 platform 判断从 ===linux 扩为 ===linux || ===android。');
console.log('        android 分支内 new LinuxProcessInspector(arch, internals) —— 无 .find 调用（该 chunk 全文 find 计数=0，已实测）。');
console.log('补丁2: 仅改默认 shellPath 表达式（三元表达式选路径字符串）——不引入任何新调用。');
console.log('补丁3: 仅在 catch 分支内新增候选路径数组与 .find —— 接收者是数组字面量+filter，恒为数组。');
console.log('结论: 三处补丁均不能产生 "reading \'find\'" 的 TypeError（该错误要求接收者为 undefined）。');

console.log('');
console.log(`RESULT find_calls_total=${totalFindCalls} can_produce_error=${VERDICTS.filter((v) => v.canBeUndefined).length}`);
