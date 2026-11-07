// 1つのHTMLファイルにまとめる（claude.ai のページとして iPad で開くため）
// 使い方: node tools/build-artifact.mjs [出力先]   既定の出力先: dist/english-drill.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dist', 'english-drill.html');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const read = (p) => readFileSync(join(root, p), 'utf8');

const cssBlock = html.match(/<!-- BUILD:CSS -->([\s\S]*?)<!-- \/BUILD:CSS -->/)[1];
const jsBlock = html.match(/<!-- BUILD:JS -->([\s\S]*?)<!-- \/BUILD:JS -->/)[1];
const css = [...cssBlock.matchAll(/href="([^"]+)"/g)].map((m) => read(m[1])).join('\n');
const js = [...jsBlock.matchAll(/src="([^"]+)"/g)].map((m) => `/* ---- ${m[1]} ---- */\n` + read(m[1])).join('\n');
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\n?/, '')
  .replace(/<meta name="viewport"[^>]*>\n?/, '')
  .replace(cssBlock, '')
  .replace(/<!-- \/?BUILD:CSS -->\n?/g, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(jsBlock, '').replace(/<!-- \/?BUILD:JS -->\n?/g, '');

// claude.ai のページは <html><head><body> を自動で付けるため、中身だけを書き出す
const result = head.trim() + '\n<style>\n' + css + '\n</style>\n' + body.trim() + '\n<script>\n' + safeJs + '\n</script>\n';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, result);
console.log('書き出しました:', out, Math.round(result.length / 1024) + 'KB');
