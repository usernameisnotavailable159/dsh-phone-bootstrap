// Re-apply Android/Termux compatibility patches after a DSH update or reinstall.
//
// Why this exists: several DSH seams branch only on linux/darwin/win32, but Termux
// reports process.platform === 'android', and npm ships no android platform packages
// for the native helpers those seams look for. Each seam therefore falls through and
// takes its tool down with it:
//
//   1. @deepseek-ai/dsh-subprocess-local — createProcessInspector() throws
//      "subprocess-local: terminal inspection is unsupported on platform android",
//      so every PTY-backed bash tool call fails outright.
//   2. @deepseek-ai/dsh-terminal-bash — the bash dialect default shellPath is a
//      hardcoded /bin/bash, which does not exist under Termux (PREFIX/bin/bash does),
//      so the PTY shell cannot start even once the inspector is fixed.
//   3. @vscode/ripgrep — resolves `@vscode/ripgrep-<platform>-<arch>/bin/rg`. Upstream
//      lists 12 platforms in optionalDependencies and none is android, so the resolve
//      throws and glob/grep fail with "ripgrep launch failed". Termux ships a native
//      ripgrep, so fall back to it instead of failing the whole search seam.
//
// Idempotent: each patch checks its own marker first; re-runs are no-ops.
// Backups: <file>.bak-android-* — created once, never overwritten, so the pristine
//   upstream file stays recoverable no matter how many upgrades happen.
//
// DSH web must be restarted afterwards: the ripgrep binary path and the terminal
// backend are resolved lazily and memoized per process, so a live process keeps
// whatever it computed at first use.
//
// usage: node patch-dsh-android-compat.mjs [dshRoot]
import fs from 'node:fs';
import path from 'node:path';

const dshRoot = process.argv[2] ?? '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh';
const modules = path.join(dshRoot, 'node_modules');
const ai = path.join(modules, '@deepseek-ai');
const prefix = process.env.PREFIX ?? '/data/data/com.termux/files/usr';

let changed = 0;
let failed = 0;

function backup(file, suffix) {
  const b = `${file}.bak-${suffix}`;
  if (!fs.existsSync(b)) fs.copyFileSync(file, b);
  return b;
}

/** Idempotent single-anchor patch: marker present -> no-op; anchor missing -> loud skip. */
function patch(file, marker, suffix, rewrite) {
  if (!fs.existsSync(file)) {
    console.log(`[warn] missing ${path.relative(dshRoot, file)} — layout changed?`);
    failed += 1;
    return;
  }
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(marker)) {
    console.log(`[ok] already patched ${path.relative(dshRoot, file)}`);
    return;
  }
  const next = rewrite(src);
  if (next === null) {
    console.log(`[warn] anchor missing, not patched: ${path.relative(dshRoot, file)}`);
    failed += 1;
    return;
  }
  backup(file, suffix);
  fs.writeFileSync(file, next);
  console.log(`[fix] patched ${path.relative(dshRoot, file)} (${src.length}B -> ${next.length}B)`);
  changed += 1;
}

// ---------- 1) subprocess-local: android shares the Linux inspector ----------
// android/arm64 is Linux ABI, so LinuxProcessInspector (and its /proc inspection)
// applies as-is. 0.1.5-rc.* moved createProcessInspector out of lib/index.js into a
// hashed runner-launch-*.js chunk, so the chunk is discovered by prefix instead of a
// hardcoded filename — that name changes between releases.
const subprocessDir = path.join(ai, 'dsh-subprocess-local', 'lib');
const runnerChunk = fs.existsSync(subprocessDir)
  ? fs.readdirSync(subprocessDir).find((f) => f.startsWith('runner-launch-') && f.endsWith('.js'))
  : null;

if (!runnerChunk) {
  console.log('[warn] runner-launch-*.js chunk not found under dsh-subprocess-local/lib');
  failed += 1;
} else {
  patch(
    path.join(subprocessDir, runnerChunk),
    'if (platform === "linux" || platform === "android") return new LinuxProcessInspector',
    'android-fix',
    (s) => {
      const anchor = 'if (platform === "linux") return new LinuxProcessInspector(arch, internals);';
      if (!s.includes(anchor)) return null;
      return s.replace(
        anchor,
        'if (platform === "linux" || platform === "android") return new LinuxProcessInspector(arch, internals);',
      );
    },
  );
}

// ---------- 2) terminal-bash: default bash shell resolves under PREFIX ----------
// "/bin/bash" stays the non-android fallback, so Linux/macOS behaviour is unchanged;
// only android (which has no /bin/bash at all) is redirected to the Termux shell.
patch(
  path.join(ai, 'dsh-terminal-bash', 'lib', 'index.js'),
  'process.platform === "android" && process.env.PREFIX',
  'android-shellpath',
  (s) => {
    const anchor = 'const DEFAULT_BASH_SHELL = "/bin/bash";';
    if (!s.includes(anchor)) return null;
    return s.replace(
      anchor,
      'const DEFAULT_BASH_SHELL = process.platform === "android" && process.env.PREFIX ? `${process.env.PREFIX}/bin/bash` : "/bin/bash";',
    );
  },
);

// ---------- 3) @vscode/ripgrep: three-tier rgPath resolution ----------
// Tier 1 is the untouched upstream behaviour, so every platform that does ship a
// platform package keeps resolving exactly as before. Termux then falls back to
// PREFIX/bin/rg and finally to any rg on PATH; only a total miss throws, with a
// Termux-specific hint. Note @vscode/ripgrep sits directly under node_modules/@vscode,
// not under the @deepseek-ai/* scope.
const RG_PATCHED = `import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const require = createRequire(import.meta.url);

const arch = process.env.npm_config_arch || process.arch;
const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
const platformPkg = \`@vscode/ripgrep-\${process.platform}-\${arch}\`;

// android-compat-patch: three-tier fallback. Upstream ships no android platform
// package, so resolve the system ripgrep instead of failing the search seam.
//   1. the platform package (upstream behaviour, unchanged)
//   2. $PREFIX/bin/rg (Termux)
//   3. any rg on PATH
let resolved;
try {
    resolved = require.resolve(\`\${platformPkg}/bin/\${binaryName}\`);
} catch {
    const candidates = [
        process.env.PREFIX ? join(process.env.PREFIX, 'bin', binaryName) : null,
        ...((process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, binaryName))),
    ].filter(Boolean);
    resolved = candidates.find((candidate) => existsSync(candidate));
    if (!resolved) {
        throw new Error(
            \`Could not find \${platformPkg}. \` +
            \`Ensure optionalDependencies are installed for this platform (\${process.platform}-\${arch}). \` +
            (process.platform === 'android'
                ? \`On Termux, install a system ripgrep instead: pkg install ripgrep\`
                : \`No fallback ripgrep found on PATH either.\`)
        );
    }
}

export const rgPath = resolved;
`;

patch(
  path.join(modules, '@vscode', 'ripgrep', 'lib', 'index.js'),
  'android-compat-patch',
  'android-rgpath',
  (s) => (s.includes('Could not find ${platformPkg}') ? RG_PATCHED : null),
);

// ---------- report ----------
const systemRg = path.join(prefix, 'bin', 'rg');
console.log('');
console.log(`system rg: ${fs.existsSync(systemRg) ? `${systemRg} (present)` : `${systemRg} MISSING — run: pkg install ripgrep`}`);
console.log(`RESULT changed=${changed} failed=${failed}`);
if (failed > 0 || !fs.existsSync(systemRg)) {
  console.log('[bootstrap] android compat patches incomplete; see warnings above.');
  process.exit(1);
}
console.log('[bootstrap] android compat patches applied; restart DSH web to take effect.');
