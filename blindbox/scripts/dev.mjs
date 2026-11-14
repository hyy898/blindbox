import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { root, devBinary, buildNative, stopChild } from './native.mjs';

const { values } = parseArgs({ options: {
  'no-open': { type: 'boolean', default: false },
  port: { type: 'string', default: '5173' },
  db: { type: 'string', default: 'data/dev-save.db' },
} });
const frontendPort = Number(values.port);
if (!Number.isInteger(frontendPort) || frontendPort < 0 || frontendPort > 65535) throw new Error('--port 必须在 0–65535 之间');
const sessionId = randomUUID();
const sessionFile = path.join(root, 'server/build/dev/session.json');
let vite, backend, nativeTask;
let ownsSession = false, closing = false, pending = false, updating = false, browserOpened = values['no-open'];
let timer;
let revision = 0, state = 'starting', lastError = '', apiUrl = '';
const abortBuild = new AbortController();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const relative = file => path.relative(root, file).split(path.sep).join('/');
const nativeInput = file => /^server\/(src\/.*\.(?:cpp|c|h|hpp)|third_party\/.*\.(?:cpp|c|h|hpp)|build\.sh|build\.ps1|编译\.bat)$/.test(relative(file));

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const task = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  task.once('error', () => console.log(`请手动打开 ${url}`));
  task.unref();
}

async function claimSession() {
  await mkdir(path.dirname(sessionFile), { recursive: true });
  for (;;) {
    try {
      const file = await open(sessionFile, 'wx');
      ownsSession = true;
      await file.writeFile(JSON.stringify({ pid: process.pid, sessionId, projectRoot: root }));
      await file.close();
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let previous;
    try { previous = JSON.parse(await readFile(sessionFile, 'utf8')); } catch {
      // 进程在首次写入前中断时，自动清理没有完成的会话记录。
      const age = Date.now() - (await stat(sessionFile).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
      if (age > 5000) await unlink(sessionFile).catch(() => {});
      else await sleep(100);
      continue;
    }
    // 复制的会话记录不能复用原目录的服务。
    if (previous.projectRoot !== root) {
      await unlink(sessionFile).catch(() => {});
      continue;
    }
    let alive = false;
    try { process.kill(previous.pid, 0); alive = true; } catch (error) { if (error.code === 'EPERM') alive = true; }
    if (!alive) { await unlink(sessionFile).catch(() => {}); continue; }
    // 只有握手与记录一致才复用这个项目的开发服务。
    for (let attempt = 0; attempt < 100; ++attempt) {
      if (previous.url) {
        try {
          const info = await fetch(new URL('__blindbox_dev_status', previous.url), { signal: AbortSignal.timeout(1000) }).then(r => r.json());
          if (info.sessionId === previous.sessionId) {
            console.log(`本项目开发模式已经运行：${previous.url}`);
            if (!values['no-open']) openBrowser(previous.url);
            return false;
          }
        } catch { /* 可能还在启动 */ }
      }
      await sleep(200);
      try { previous = JSON.parse(await readFile(sessionFile, 'utf8')); } catch { break; }
    }
    throw new Error('本项目已有开发进程正在启动，请查看原开发窗口。');
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startBackend(port) {
  const child = spawn(devBinary, ['--port', String(port), '--web', root, '--models', path.join(root, 'models'),
    '--db', path.resolve(root, values.db)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  backend = child;
  let actualPort = null, startupText = '';

  child.stdout.setEncoding('utf8').on('data', chunk => {
    process.stdout.write(chunk);
    startupText = (startupText + chunk).slice(-4000);
    const match = /开盲盒服务器已启动\s+http:\/\/127\.0\.0\.1:(\d+)\//.exec(startupText);
    if (match) actualPort = Number(match[1]);
  });
  child.stderr.pipe(process.stderr, { end: false });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.once('exit', () => {
    if (backend === child) {
      backend = null;
      if (!closing && !updating) reportError('游戏服务器意外退出；修正源码后保存会重新启动。');
    }
  });
  for (let i = 0; i < 150; ++i) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('游戏服务器启动失败，请查看编译窗口。');
    if (actualPort !== null && actualPort !== port) {
      backend = null; await stopChild(child);
      throw new Error('开发 API 端口被其他程序占用，请重新启动开发模式。');
    }
    if (actualPort === port) {
      try {
        const health = await fetch(apiUrl + 'api/health', { signal: AbortSignal.timeout(800) }).then(r => r.json());
        if (health.ok && health.name === 'blindbox-server') return;
      } catch { /* 等待 HTTP 接口就绪 */ }
    }
    await sleep(100);
  }
  throw new Error('等待游戏服务器启动超时。');
}

function reportError(message, details = '') {
  state = 'error'; lastError = message;
  console.error(`\n[开发错误] ${message}\n修改并保存后会自动重试。`);
  vite?.ws.send({ type: 'error', err: { message, stack: details, plugin: 'blindbox-cpp' } });
}

async function rebuild(port) {
  if (updating || closing) return;
  updating = true;
  try {
    while (pending && !closing) {
      pending = false; state = 'building'; lastError = '';
      console.log('\n[开发] 正在编译 C++ 更新，上一版会继续运行到编译成功。');
      nativeTask = buildNative({ development: true, signal: abortBuild.signal });
      const result = await nativeTask;
      nativeTask = null;
      if (closing) return;
      if (result.code !== 0) {
        if (pending) continue;
        reportError('C++ 编译或配置检查失败，已保留上一份可用程序。', result.output);
        continue;
      }
      if (pending) continue;
      const previous = backend; backend = null;
      await stopChild(previous);
      if (closing) return;
      await startBackend(port);
      if (closing) return;
      ++revision; state = 'ready';
      vite.ws.send({ type: 'full-reload', path: '*' });
      console.log(`[开发] 更新已生效 #${revision}，游戏网页会自动刷新。`);
      if (!browserOpened) { browserOpened = true; openBrowser(vite.resolvedUrls.local[0]); }
    }
  } catch (error) {
    if (!closing) reportError(error.message, error.stack);
  } finally {
    updating = false;
    if (pending && !closing) void rebuild(port);
  }
}

async function shutdown(code = 0) {
  if (closing) return;
  closing = true; clearTimeout(timer); abortBuild.abort();
  await nativeTask?.catch(() => {});
  const previous = backend; backend = null;
  await stopChild(previous);
  await vite?.close();
  if (ownsSession) {
    try {
      if (JSON.parse(await readFile(sessionFile, 'utf8')).sessionId === sessionId) await unlink(sessionFile);
    } catch { /* 会话文件已清理 */ }
  }
  process.exitCode = code;
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

try {
  if (await claimSession()) {
    const port = await freePort();
    apiUrl = `http://127.0.0.1:${port}/`;
    const originalTermListeners = new Set(process.listeners('SIGTERM'));
    const originalStdinListeners = new Set(process.stdin.listeners('end'));
    vite = await createServer({
      configFile: path.join(root, 'vite.config.mjs'),
      clearScreen: false,
      server: {
        host: '127.0.0.1', port: frontendPort,
        fs: { allow: [root] },
        watch: { usePolling: true, interval: 300, pollInterval: 300, ignoreInitial: true, ignored: ['**/server/build/**', '**/data/**'] },
        proxy: { '/api': { target: apiUrl }, '/models': { target: apiUrl } },
      },
      plugins: [{
        name: 'blindbox-backend-watch',
        configureServer(server) {
          server.middlewares.use('/__blindbox_dev_status', (_req, res) => {
            res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({ sessionId, state, revision, apiUrl, error: lastError }));
          });
        },
        handleHotUpdate(context) { if (nativeInput(context.file)) return []; },
      }],
    });
    // 由这个控制进程统一清理 Vite、编译器和 C++ 子进程，避免 Vite 提前结束进程。
    for (const listener of process.listeners('SIGTERM')) {
      if (!originalTermListeners.has(listener)) process.removeListener('SIGTERM', listener);
    }
    for (const listener of process.stdin.listeners('end')) {
      if (!originalStdinListeners.has(listener)) process.stdin.removeListener('end', listener);
    }
    await vite.listen();
    const url = vite.resolvedUrls.local[0];
    await writeFile(sessionFile, JSON.stringify({ pid: process.pid, sessionId, projectRoot: root, url }));
    console.log(`\n[开发] 游戏地址：${url}\n[开发] 保存 C++ / 前端源码后自动更新；git pull 得到的修改也会触发。\n[开发] 这是常驻开发模式，结束开发时在本窗口按 Ctrl+C。存档：${values.db}`);
    vite.watcher.add(['server/src', 'server/third_party', 'server/build.sh', 'server/build.ps1', 'server/编译.bat', 'models'].map(file => path.join(root, file)));
    vite.watcher.on('all', (_event, file) => {
      if (nativeInput(file)) {
        pending = true; clearTimeout(timer);
        timer = setTimeout(() => { void rebuild(port); }, 400);
      } else if (relative(file).startsWith('models/') && /\.glb$/i.test(file)) {
        vite.ws.send({ type: 'full-reload', path: '*' });
      }
    });
    pending = true;
    await rebuild(port);
  }
} catch (error) {
  console.error(error.message);
  await shutdown(1);
}
