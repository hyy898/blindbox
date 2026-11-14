import { build } from 'vite';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { root } from './native.mjs';

async function list(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? list(file) : [file];
  }));
  return nested.flat();
}
const inputs = [...await list(path.join(root, 'web')), ...['package.json', 'package-lock.json', 'vite.config.mjs', 'scripts/build-web.mjs'].map(name => path.join(root, name))].sort();
const hash = createHash('sha256');
for (const file of inputs) hash.update(path.relative(root, file)).update(await readFile(file));
const signature = hash.digest('hex');
const stamp = path.join(root, 'server/build/web.stamp');
let previous;
try { previous = await readFile(stamp, 'utf8'); } catch { /* 首次构建 */ }
let hasOutput = false;
try {
  const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)=["']\.\/([^"']+)/g)].map(match => match[1]);
  await Promise.all(assets.map(file => access(path.join(root, 'dist', file))));
  hasOutput = assets.length > 0;
} catch { /* 尚未构建或产物不完整 */ }
if (process.argv.includes('--if-needed') && hasOutput && previous === signature) {
  console.log('前端源码没有变化，使用已有试玩网页。');
} else {
  await build({ configFile: path.join(root, 'vite.config.mjs') });
  // 构建过程中再次修改源码时，下一次启动仍会重新构建。
  await mkdir(path.dirname(stamp), { recursive: true });
  await writeFile(stamp, signature);
}
