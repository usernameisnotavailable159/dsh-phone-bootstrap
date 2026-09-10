// scan-sessions.mjs — 解压扫描全部 DSH 会话记录，定位指定报错的出处
//
// 关键：会话文件是多帧拼接 zstd（追加写）。实测同一文件 1.76MB：
//   单帧 API (zstdDecompressSync) → 221 字节（只解第一帧，漏 99.996%）
//   多帧分帧解压          → 5,552,499 字节 / 764 帧（全部 OK）
// 故必须按魔法字节 28 B5 2F FD 分帧后逐帧解压。
//
// 用法: node scan-sessions.mjs ["搜索串"]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const ROOT = '/data/data/com.termux/files/home/.dsh/sessions';
const NEEDLE = process.argv[2] ?? "Cannot read properties of undefined (reading 'find')";
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function collect(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (e.name.endsWith('.zstd')) out.push(p);
  }
  return out;
}

/** 分帧解压：返回 { text, frames, ok, fail, singleFrameBytes } */
function decodeMultiFrame(buf) {
  const offsets = [];
  let cursor = 0;
  while (true) {
    const i = buf.indexOf(MAGIC, cursor);
    if (i === -1) break;
    offsets.push(i);
    cursor = i + MAGIC.length;
  }
  offsets.push(buf.length);

  let text = '';
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < offsets.length - 1; i += 1) {
    try {
      text += zstdDecompressSync(buf.subarray(offsets[i], offsets[i + 1])).toString('utf8');
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  let singleFrameBytes = -1;
  try {
    singleFrameBytes = zstdDecompressSync(buf).toString('utf8').length;
  } catch {
    /* ignore */
  }
  return { text, frames: offsets.length - 1, ok, fail, singleFrameBytes };
}

const files = collect(ROOT);
console.log(`SESSION_ROOT=${ROOT}`);
console.log(`SCANNED=${files.length}`);
console.log(`NEEDLE=${JSON.stringify(NEEDLE)}`);

const hits = [];
let decodedBytes = 0;

for (const f of files) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue;
  }
  const { text, frames, ok, fail, singleFrameBytes } = decodeMultiFrame(buf);
  decodedBytes += text.length;
  if (!text.includes(NEEDLE)) continue;

  const lines = text.split('\n');
  const idxs = [];
  lines.forEach((l, i) => {
    if (l.includes(NEEDLE)) idxs.push(i);
  });

  // 会话 ID：取路径里的 session-* 段；cwd 组名也带上
  const parts = f.split('/');
  const sid = parts.find((p) => p.startsWith('session-') || /^[0-9a-f]{8}-/.test(p)) ?? parts[parts.length - 2];
  const group = parts[parts.length - 3] ?? '?';

  // 每条命中取前后各 2 行做上下文
  const contexts = idxs.slice(0, 3).map((i) => ({
    line: i + 1,
    before: lines.slice(Math.max(0, i - 2), i).map((s) => s.slice(0, 400)),
    at: lines[i].slice(0, 1500),
    after: lines.slice(i + 1, i + 3).map((s) => s.slice(0, 400)),
  }));

  hits.push({
    file: f,
    group,
    sid,
    mtime: statSync(f).mtime.toISOString(),
    occurrences: idxs.length,
    frames,
    framesOk: ok,
    framesFail: fail,
    singleFrameBytes,
    multiFrameBytes: text.length,
    firstSeenLine: idxs[0] + 1,
    contexts,
  });
}

console.log(`TOTAL_DECODED_BYTES=${decodedBytes}`);
console.log(`HIT_SESSIONS=${hits.length}`);
console.log('');

hits.sort((a, b) => (a.mtime < b.mtime ? -1 : 1));
for (const h of hits) {
  console.log('========================================');
  console.log(`SID=${h.sid}`);
  console.log(`GROUP=${h.group}`);
  console.log(`MTIME=${h.mtime}`);
  console.log(`OCCURRENCES=${h.occurrences}`);
  console.log(`FRAMES=${h.frames} OK=${h.framesOk} FAIL=${h.framesFail}`);
  console.log(`SINGLE_FRAME_BYTES=${h.singleFrameBytes} MULTI_FRAME_BYTES=${h.multiFrameBytes}`);
  for (const c of h.contexts) {
    console.log(`--- line ${c.line} ---`);
    for (const b of c.before) console.log(`  | ${b}`);
    console.log(`  > ${c.at}`);
    for (const a of c.after) console.log(`  | ${a}`);
  }
  console.log('');
}
console.log(`RESULT scanned=${files.length} hits=${hits.length}`);
