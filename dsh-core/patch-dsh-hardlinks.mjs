// Re-apply Android/Termux hardlink fallbacks after a DSH update/reinstall.
// Termux processes here run under SELinux `runas_app`, where link(2) returns
// EACCES. DSH uses hardlinks for atomic file publication; this script swaps
// those publication primitives for rename/copy fallbacks when link is denied.
import fs from 'node:fs';
import path from 'node:path';

const dshRoot = process.argv[2] ?? '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh';
const mods = path.join(dshRoot, 'node_modules', '@deepseek-ai');

function backup(file) {
  const b = `${file}.bak-android-link`;
  if (!fs.existsSync(b)) fs.copyFileSync(file, b);
}

function patch(file, marker, rewrite) {
  if (!fs.existsSync(file)) { console.log(`[skip] missing ${file}`); return; }
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes(marker)) { console.log(`[ok] already patched ${path.relative(dshRoot, file)}`); return; }
  const next = rewrite(s);
  if (next === null) { console.log(`[warn] anchor missing, not patched: ${path.relative(dshRoot, file)}`); return; }
  backup(file);
  fs.writeFileSync(file, next);
  console.log(`[fix] patched ${path.relative(dshRoot, file)}`);
}

const sessionHelper = `
/**
 * Android/Termux under run-as (SELinux runas_app) denies hardlink with
 * EACCES/EPERM. Hardlink is used only to publish a temp file onto a target in
 * the same directory, so rename is an atomic equivalent while EEXIST handling
 * remains with the caller.
 */
async function linkOrRename(from, to) {
try {
await link(from, to);
} catch (error) {
if (error && (error.code === "EACCES" || error.code === "EPERM" || error.code === "ENOTSUP" || error.code === "EXDEV")) {
await rename(from, to);
return;
}
throw error;
}
}
`;

patch(
  path.join(mods, 'dsh-session-persistence-jsonl/lib/index.js'),
  'linkOrRename',
  (s) => {
    if (!s.includes('readdir, realpath, rm,')) return null;
    s = s.replace('readdir, realpath, rm,', 'readdir, realpath, rename, rm,');
    const anchor = 'from "node:fs/promises";\n';
    const i = s.indexOf(anchor);
    if (i < 0) return null;
    s = s.slice(0, i + anchor.length) + sessionHelper + s.slice(i + anchor.length);
    s = s.replace('\tlink,\n', '\tlink: linkOrRename,\n');
    s = s.replace('await link(tmp, finalPath);', 'await linkOrRename(tmp, finalPath);');
    return s;
  },
);

const workerWrapper = `\tlink: async (from, to) => {
\t\ttry {
\t\t\treturn await node_fs_promises.link(from, to);
\t\t} catch (error) {
\t\t\tif (error && (error.code === "EACCES" || error.code === "EPERM" || error.code === "ENOTSUP" || error.code === "EXDEV")) {
\t\t\t\treturn await node_fs_promises.rename(from, to);
\t\t\t}
\t\t\tthrow error;
\t\t}
\t},
`;
patch(
  path.join(mods, 'dsh-session-persistence-jsonl/lib/worker.cjs'),
  'node_fs_promises.rename',
  (s) => {
    const old = '\tlink: node_fs_promises.link,\n';
    if (!s.includes(old)) return null;
    return s.replace(old, workerWrapper, 1);
  },
);

const copyHelper = `
/** Android/Termux runas_app denies hardlink; copy with COPYFILE_EXCL keeps no-replace semantics. */
async function linkOrCopyExclusive(from, to, constants) {
try {
await link(from, to);
} catch (error) {
if (error && (error.code === "EACCES" || error.code === "EPERM" || error.code === "ENOTSUP" || error.code === "EXDEV")) {
await copyFile(from, to, constants.COPYFILE_EXCL);
return;
}
throw error;
}
}
`;

patch(
  path.join(mods, 'dsh-attachment-local/lib/index.js'),
  'linkOrCopyExclusive',
  (s) => {
    if (!s.includes('chmod, link, mkdir')) return null;
    s = s.replace('chmod, link, mkdir', 'chmod, copyFile, link, mkdir');
    const anchor = 'import sharp from "sharp";\n';
    const i = s.indexOf(anchor);
    if (i < 0) return null;
    s = s.slice(0, i + anchor.length) + copyHelper + s.slice(i + anchor.length);
    s = s.replace('await link(source, target);', 'await linkOrCopyExclusive(source, target, constants);');
    s = s.replace('await link(staged.path, target);', 'await linkOrCopyExclusive(staged.path, target, constants);');
    return s;
  },
);

patch(
  path.join(mods, 'dsh-fs-local/lib/index.js'),
  'linkOrCopyExclusive',
  (s) => {
    if (!s.includes('chmod, link, lstat')) return null;
    s = s.replace('import { createReadStream } from "node:fs";', 'import { constants as fsConstants, createReadStream } from "node:fs";');
    s = s.replace('chmod, link, lstat', 'chmod, copyFile, link, lstat');
    const anchor = '//#region lib/types/win32.js\n';
    const i = s.indexOf(anchor);
    if (i < 0) return null;
    s = s.slice(0, i + anchor.length) + copyHelper.replace('linkOrCopyExclusive(from, to, constants)', 'linkOrCopyExclusive(from, to)').replace('constants.COPYFILE_EXCL', 'fsConstants.COPYFILE_EXCL') + s.slice(i + anchor.length);
    s = s.replace('const linkFile = internals.linkFile ?? link;', 'const linkFile = internals.linkFile ?? linkOrCopyExclusive;');
    return s;
  },
);

console.log('[done] hardlink fallbacks checked');
