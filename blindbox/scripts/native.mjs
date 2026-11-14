import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const devBinary = path.join(root, 'server/build/dev', process.platform === 'win32' ? 'blindbox-server.exe' : 'blindbox-server');
export const normalBinary = path.join(root, process.platform === 'win32' ? 'blindbox-server.exe' :
  process.platform === 'darwin' ? `blindbox-server-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}` : 'server/blindbox-server');

// 只结束由当前开发进程创建的子进程树。
export async function stopChild(child, tree = false) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve));
  if (tree && process.platform === 'win32') {
    await new Promise(resolve => {
      const task = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      task.once('exit', resolve); task.once('error', resolve);
    });
  } else {
    try { process.kill(tree ? -child.pid : child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  let timer;
  await Promise.race([ended, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(tree && process.platform !== 'win32' ? -child.pid : child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await ended;
  }
}

export function buildNative({ development = false, signal } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (development) {
      env.OUT = 'build/dev/blindbox-server';
      env.BLINDBOX_OUTPUT = 'build/dev/blindbox-server.exe';
    }
    const windows = process.platform === 'win32';
    const child = spawn(windows ? 'cmd.exe' : '/bin/sh',
      windows ? ['/d', '/c', 'server\\编译.bat', 'nopause'] : ['server/build.sh'],
      { cwd: root, env, detached: !windows, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    function record(chunk, stream) {
      stream.write(chunk);
      output = (output + chunk).slice(-12000);
    }
    child.stdout.setEncoding('utf8').on('data', chunk => record(chunk, process.stdout));
    child.stderr.setEncoding('utf8').on('data', chunk => record(chunk, process.stderr));
    const abort = () => { void stopChild(child, true); };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', reject);
    child.once('exit', code => {
      signal?.removeEventListener('abort', abort);
      resolve({ code: code ?? 1, output });
    });
    if (signal?.aborted) abort();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildNative();
  process.exitCode = result.code;
}
