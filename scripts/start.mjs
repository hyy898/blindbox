import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildNative, devBinary } from '../blindbox/scripts/native.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gameRoot = join(root, 'blindbox');
const args = process.argv.slice(2);
const isolated = args.includes('--isolated');
const keepAlive = args.includes('--keep-alive');
const forwarded = args.filter(arg => !['--isolated', '--keep-alive', '--exit-on-close'].includes(arg));
if (forwarded.includes('--db') || forwarded.includes('--web') || forwarded.includes('--models')) {
  console.error('请使用 --isolated 创建测试存档；启动器固定使用本项目的网页、资源和存档目录。');
  process.exit(1);
}
const name = process.platform === 'win32' ? 'blindbox-server.exe'
  : process.platform === 'darwin' ? `blindbox-server-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}` : null;
if (!name) {
  console.error('当前仓库仅提供 macOS 与 Windows 服务程序，尚未提供 Linux 版本。');
  process.exit(1);
}
if (!existsSync(join(gameRoot, 'dist/index.html'))) {
  console.error('缺少游戏网页。请在项目根目录执行 npm ci 和 npm run build。');
  process.exit(1);
}
let source = join(gameRoot, name);
if (existsSync(join(gameRoot, 'server/src/main.cpp'))) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, cancel);
  let result;
  try { result = await buildNative({ development: true, signal: controller.signal }); }
  catch (error) { console.error(`无法自动编译服务：${error.message}`); process.exitCode = 1; }
  finally { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, cancel); }
  if (controller.signal.aborted) process.exit(130);
  if (!result || result.code !== 0) process.exit(1);
  source = devBinary;
}
if (!existsSync(source)) {
  console.error('缺少服务程序，请恢复完整项目后重新启动。');
  process.exit(1);
}
// Run an exact copy so Git-tracked binaries never change permissions or contents.
const runtime = join(root, '.local/runtime');
mkdirSync(runtime, { recursive: true });
const hash = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 12);
const executable = join(runtime, `${hash}-${name}`);
if (!existsSync(executable)) copyFileSync(source, executable);
if (process.platform !== 'win32') chmodSync(executable, 0o755);
const dataDir = isolated ? mkdtempSync(join(tmpdir(), 'qiwu-preview-')) : join(gameRoot, 'data');
mkdirSync(dataDir, { recursive: true });
const database = join(dataDir, 'blindbox-save.db');
console.log(isolated ? '奇物百货 · 隔离试玩（不读取或修改原有收藏）' : '奇物百货 · 本机收藏');
console.log(`存档：${database}`);
console.log(keepAlive ? '开发常驻模式：按 Ctrl+C 关闭服务；存档会保留。'
  : '关闭所有游戏网页后 5 秒自动结束服务；刷新页面和切到后台不受影响。');
const child = spawn(executable, [
  '--web', join(gameRoot, 'dist'), '--models', join(gameRoot, 'models'), '--db', database,
  ...(keepAlive ? [] : ['--exit-on-close']),
  ...forwarded,
], { cwd: gameRoot, stdio: 'inherit' });
child.on('error', error => { console.error(`无法启动：${error.message}`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal === 'SIGINT' ? 0 : code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!child.killed) child.kill(signal); });
