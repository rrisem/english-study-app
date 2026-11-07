// テスト・チェック用：ブラウザ用のスクリプトを Node の中で読み込む
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export function loadEA(files, opts = {}) {
  return loadWith(files || DEFAULT_FILES, opts);
}
const DEFAULT_FILES = ['js/core.js', 'data/config.js', 'data/infinitive.js', 'js/grading.js', 'js/mastery.js', 'js/scheduler.js', 'js/storage.js', 'js/planner.js', 'js/session.js'];
function loadWith(files, opts) {
  const store = opts.store || new Map();
  const ctx = {
    console,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { if (opts.failWrites) throw new Error('QuotaExceededError'); store.set(k, String(v)); }, removeItem: (k) => store.delete(k) },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
  ctx.EA.__store = store;
  return ctx.EA;
}
