// repro-router-spec-crash.mjs — 固化 router-spec preset 的 sessionMode 崩溃复现
//
// 背景：会话 session-cab90138（agentPreset 切到 router-spec）在 turn 1 即崩：
//   {kind:"error", error:{message:"Cannot read properties of undefined (reading 'find')", code:"UNKNOWN"}}
//
// 根因（本脚本验证）：router-core.mjs 的 sessionMode(session) 直接读 session.events，
// 但官方 @deepseek-ai/dsh-session 的 Session 类**没有 events 成员**（提供的是
// snapshotEvents()/ownEvents()），故 session.events 恒为 undefined → .find 抛错。
//
// 本脚本直接 import 真实 preset 模块（非 mock），断言：
//   1. 传入无 events 的 session 形状 → 抛出逐字匹配原始报错的 TypeError
//   2. 对照：带 events 数组 / 空 events 数组 → 不抛（证明是本形状差异，非模块损坏）
//
// 用法: node repro-router-spec-crash.mjs   （复现成功 → exit 0）
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PRESET_DIR = '/data/data/com.termux/files/home/.dsh/.agent-presets/router-spec';
const CORE = `${PRESET_DIR}/router-core.mjs`;
const EXPECTED = "Cannot read properties of undefined (reading 'find')";

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};

console.log(`PRESET_DIR=${PRESET_DIR}`);
check('P0 真实 preset 模块存在', existsSync(CORE), CORE);
if (!existsSync(CORE)) {
  console.log('RESULT FAILED:' + failed);
  process.exit(1);
}

const core = await import(pathToFileURL(CORE).href);
check('P1 sessionMode 已导出', typeof core.sessionMode === 'function', `typeof=${typeof core.sessionMode}`);

/** 调 sessionMode 并捕获结果 */
const trySessionMode = (session) => {
  try {
    return { threw: false, value: core.sessionMode(session) };
  } catch (e) {
    return { threw: true, name: e.constructor.name, message: e.message };
  }
};

// --- 核心复现：session 存在但无 events 属性 ---
// 双模式语义：
//   未修复 → 应抛目标报错（REPRODUCED）
//   已修复 → 不应抛错（FIXED_OK）
// 两种都算该脚本"跑通"（exit 0），据此可判定当前处于哪一侧。
const r1 = trySessionMode({ id: 'repro-no-events' });
const r2 = trySessionMode({ id: 'repro-events-undefined', events: undefined });
const bugStillPresent = r1.threw && r1.message === EXPECTED;

if (bugStillPresent) {
  console.log('MODE=BUG_PRESENT（修复前）');
  check('R1 无 events 属性的 session → 抛出目标报错（逐字）', r1.message === EXPECTED, `${r1.name}: ${r1.message}`);
  check('R2 events 显式 undefined → 同样抛出目标报错', r2.threw && r2.message === EXPECTED, `${r2.name}: ${r2.message}`);
  // 对照：证明是本形状差异而非模块损坏
  const rc1 = trySessionMode({ id: 'normal', events: [{ type: 'user/message', data: { content: [{ text: '创建一个HTML，内容是SVG绘制的一个鹈鹕骑自行车的2D动画' }] } }] });
  check('C1 带 events 数组 → 不抛（对照）', !rc1.threw, `value=${JSON.stringify(rc1.value)}`);
  const rc2 = trySessionMode({ id: 'empty', events: [] });
  check('C2 空 events 数组 → 不抛，返回 weak', !rc2.threw && rc2.value === 'weak', `value=${JSON.stringify(rc2.value)}`);
} else {
  console.log('MODE=FIXED（修复已生效）');
  check('R1 无 events 属性的 session → 不再抛错', !r1.threw && r1.value === 'weak', r1.threw ? `仍抛: ${r1.message}` : `value=${JSON.stringify(r1.value)}`);
  check('R2 events 显式 undefined → 不再抛错', !r2.threw && r2.value === 'weak', r2.threw ? `仍抛: ${r2.message}` : `value=${JSON.stringify(r2.value)}`);
  const rc = trySessionMode({
    id: 'official',
    snapshotEvents: () => [{ type: 'user/message', data: { content: [{ text: '创建一个HTML，内容是SVG绘制的一个鹈鹕骑自行车的2D动画' }] } }],
  });
  check('C1 官方形状 snapshotEvents() → 正确分类为 1', !rc.threw && rc.value === 1, `value=${JSON.stringify(rc.value)}`);
  const rc3 = trySessionMode(undefined);
  check('C2 整个 session 为 undefined → 兜底不抛', !rc3.threw && rc3.value === 'weak', rc3.threw ? `仍抛: ${rc3.message}` : `value=${JSON.stringify(rc3.value)}`);
}

// --- 官方 Session 类无 events 成员（根因佐证）---
console.log('');
console.log('注：官方 @deepseek-ai/dsh-session 的 Session 类公开成员为');
console.log('    get surface / get id / eventAt / snapshotEvents / ownEvents / isOwnSeq / get seq / append / requestHeader / requestContext');
console.log('    —— 无 events 属性，故 session.events 恒为 undefined（见 probe:session_class_members）。');

console.log('');
console.log(`RESULT ${failed === 0 ? (bugStillPresent ? "REPRODUCED" : "FIXED_OK") : "FAILED:" + failed}`);
process.exit(failed === 0 ? 0 : 1);
