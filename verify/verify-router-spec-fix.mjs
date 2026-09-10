// verify-router-spec-fix.mjs — router-spec preset sessionMode 崩溃修复的验收脚本
//
// 修复前（bug）：sessionMode(session) 读 session.events，而官方 @deepseek-ai/dsh-session
//   的 Session 类没有 events 成员 → events 恒 undefined → .find 抛
//   "Cannot read properties of undefined (reading 'find')"，会话语 session-cab90138 turn 1 即崩。
// 修复后：三级取法 session.events(数组) → session.snapshotEvents() → []，并叠 session 空值保护。
//
// 断言：
//   F1 无 events 属性的 session 不再抛错（回归守卫核心）
//   F2 完整 undefined session 不再抛错
//   F3 真实官方形状（只提供 snapshotEvents()）能正确分类
//   F4 本案例文本（HTML/SVG 动画）分类为 1 = react
//   F5 向后兼容：旧形状（带 events 数组）仍正常
//   F6 空事件 → weak
//   F7 导出面未损（其他函数仍可用）
//
// 用法: node verify-router-spec-fix.mjs   全 PASS → exit 0
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LIVE = '/data/data/com.termux/files/home/.dsh/.agent-presets/router-spec/router-core.mjs';
const REPO = '/data/data/com.termux/files/home/projects/dsh-phone-bootstrap/presets/router-spec/router-core.mjs';
const BUG_MESSAGE = "Cannot read properties of undefined (reading 'find')";

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};

console.log(`LIVE=${LIVE}`);
check('F0 live preset 存在', existsSync(LIVE), 'file present');

const core = await import(pathToFileURL(LIVE).href);

const safe = (session) => {
  try {
    return { threw: false, value: core.sessionMode(session) };
  } catch (e) {
    return { threw: true, message: e.message };
  }
};

// F1: 无 events 属性（原 bug 触发形状）——修复后不应抛
const r1 = safe({ id: 'no-events' });
check('F1 无 events 属性不再抛错（原 bug 形状）', !r1.threw && r1.value === 'weak', r1.threw ? `仍抛: ${r1.message}` : `value=${JSON.stringify(r1.value)}`);
check('F1b 若仍抛则不得等于原 bug 消息', !r1.threw || r1.message !== BUG_MESSAGE, r1.threw ? r1.message : 'no throw');

// F2: 整个 session 为 undefined —— 修复后应兜底
const r2 = safe(undefined);
check('F2 session 为 undefined 不再抛错', !r2.threw && r2.value === 'weak', r2.threw ? `仍抛: ${r2.message}` : `value=${JSON.stringify(r2.value)}`);

// F3/F4: 真实官方形状（只有 snapshotEvents()），本案例文本应分类为 1=react
const officialShape = {
  id: 'official',
  snapshotEvents() {
    return [{ type: 'user/message', data: { content: [{ text: '创建一个HTML，内容是SVG绘制的一个鹈鹕骑自行车的2D动画' }] } }];
  },
};
const r3 = safe(officialShape);
check('F3 官方形状（snapshotEvents）可正常分类', !r3.threw, r3.threw ? r3.message : `value=${JSON.stringify(r3.value)}`);
check('F4 本案例文本分类=1（react 域）', r3.value === 1, `value=${JSON.stringify(r3.value)}`);

// F5: 向后兼容 —— 旧形状（直接给 events 数组）仍工作
const r5 = safe({
  id: 'legacy',
  events: [{ type: 'user/message', data: { content: [{ text: '创建一个HTML SVG动画' }] } }],
});
check('F5 向后兼容：带 events 数组仍正常', !r5.threw && r5.value === 1, r5.threw ? r5.message : `value=${JSON.stringify(r5.value)}`);

// F6: 空事件 → weak
const r6 = safe({ id: 'empty', events: [] });
check('F6 空事件数组 → weak', !r6.threw && r6.value === 'weak', `value=${JSON.stringify(r6.value)}`);

const r6b = safe({ id: 'empty-snap', snapshotEvents: () => [] });
check('F6b snapshotEvents 返回空数组 → weak', !r6b.threw && r6b.value === 'weak', `value=${JSON.stringify(r6b.value)}`);

// F7: 导出面未损
for (const fn of ['sessionMode', 'classifyTask', 'extractText', 'personaFor', 'coreFor', 'bandOf']) {
  check(`F7 导出未损：${fn}`, typeof core[fn] === 'function', `typeof=${typeof core[fn]}`);
}

// F8: 两份副本一致（仓库 restore.sh 会覆盖 live）
const { readFileSync } = await import('node:fs');
if (existsSync(REPO)) {
  const same = readFileSync(LIVE, 'utf8') === readFileSync(REPO, 'utf8');
  check('F8 live 与仓库副本逐字节一致（防 restore 回退）', same, same ? 'identical' : 'DIFFER — restore.sh 会引入旧 bug');
} else {
  check('F8 live 与仓库副本逐字节一致（防 restore 回退）', false, '仓库副本缺失');
}

console.log('');
console.log(`RESULT ${failed === 0 ? 'FIX_VERIFIED' : 'FAILED:' + failed}`);
process.exit(failed === 0 ? 0 : 1);
