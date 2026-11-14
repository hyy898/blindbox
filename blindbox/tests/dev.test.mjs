import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, symlink, readFile, writeFile, rm, access, mkdir, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root } from '../scripts/native.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw lastError || new Error('等待验证条件超时');
}
const json = url => fetch(url, { signal: AbortSignal.timeout(2000) }).then(response => response.json());

// 所有修改都在临时源码副本中完成，不改变开发者的配置和存档。
test('团队开发：自动重编译、网页通知、错误恢复、独立存档和退出清理', { timeout: 240000 }, async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'blindbox team 开发 '));
  const fixtureRoot = await realpath(fixture) + path.sep;
  let controller, socket;
  let output = '';
  try {
    await cp(root, fixture, { recursive: true, filter(file) {
      const name = path.relative(root, file).split(path.sep).join('/');
      return !/^(?:node_modules|data|dist|\.git)(?:\/|$)/.test(name) &&
        !/(?:^|\/)\.DS_Store$/.test(name) && name !== 'server/build/dev/session.json';
    } });
    await symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const config = path.join(fixture, 'server/src/game_config.cpp');
    const original = await readFile(config, 'utf8');
    const sessionFile = path.join(fixture, 'server/build/dev/session.json');
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(sessionFile, JSON.stringify({ pid: process.pid, sessionId: 'copied-session', projectRoot: root, url: 'http://127.0.0.1:1/' }));
    controller = spawn(process.execPath, ['scripts/dev.mjs', '--no-open', '--port', '0'], { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] });
    controller.stdout.setEncoding('utf8').on('data', text => { output += text; });
    controller.stderr.setEncoding('utf8').on('data', text => { output += text; });
    const url = await until(async () => {
      if (controller.exitCode !== null) throw new Error(output);
      const info = JSON.parse(await readFile(path.join(fixture, 'server/build/dev/session.json'), 'utf8'));
      return info.pid === controller.pid && info.projectRoot === fixtureRoot && info.url;
    });
    const status = () => json(url + '__blindbox_dev_status');
    const first = await until(async () => { const s = await status(); return s.state === 'ready' && s; });
    const initial = await json(url + 'api/config');
    assert.equal((await json(url + 'api/state')).state.coins, initial.economy.startCoins);
    assert.equal(await fetch(url + 'api/session').then(r => r.status), 204, '开发服务不随网页关闭退出');
    assert.match(await fetch(url).then(r => r.text()), /@vite\/client/);
    const client = await fetch(url + '@vite/client').then(r => r.text());
    const token = /(?:const\s+)?wsToken\s*=\s*["']([^"']+)/.exec(client)?.[1];
    const wsUrl = new URL(url); wsUrl.protocol = 'ws:';
    if (token) wsUrl.searchParams.set('token', token);
    const messages = [];
    socket = new WebSocket(wsUrl, 'vite-hmr');
    socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
    await until(() => messages.some(m => m.type === 'connected'), 10000);

    const firstSeries = initial.series[0];
    const open = await fetch(url + 'api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seriesId: firstSeries.id }) }).then(r => r.json());
    assert.equal(open.ok, true);
    const saved = await fetch(url + 'api/storage', { method: 'POST' }).then(r => r.json()).then(r => r.state);
    const changed = original.replace(JSON.stringify(firstSeries.name), '"自动更新验证"');
    assert.notEqual(changed, original);
    await writeFile(config, changed);
    const updated = await until(async () => { const s = await status(); return s.state === 'ready' && s.revision > first.revision && s; });
    assert.equal((await json(url + 'api/config')).series[0].name, '自动更新验证');
    assert.deepEqual((await json(url + 'api/state')).state, saved);
    await until(() => messages.some(m => m.type === 'full-reload'), 10000);

    await writeFile(config, changed + '\nINVALID_TEAM_DEV_CPP\n');
    await until(async () => (await status()).state === 'error');
    assert.equal((await json(url + 'api/config')).series[0].name, '自动更新验证', '编译失败保留上一版服务');
    await until(() => messages.some(m => m.type === 'error'), 10000);
    await writeFile(config, changed.replace('自动更新验证', '错误修复验证'));
    const fixed = await until(async () => { const s = await status(); return s.state === 'ready' && s.revision > updated.revision && s; });
    assert.equal((await json(url + 'api/config')).series[0].name, '错误修复验证');
    assert.deepEqual((await json(url + 'api/state')).state, saved);

    const html = path.join(fixture, 'web/index.html');
    const count = messages.filter(m => m.type === 'full-reload').length;
    await writeFile(html, (await readFile(html, 'utf8')).replace('<title>', '<title>前端自动更新验证 · '));
    await until(() => messages.filter(m => m.type === 'full-reload').length > count, 10000);
    assert.match(await fetch(url).then(r => r.text()), /前端自动更新验证/);
    assert.equal((await status()).revision, fixed.revision, '前端改动不重新编译 C++');
    const modelCount = messages.filter(m => m.type === 'full-reload').length;
    await writeFile(path.join(fixture, 'models/__watch_test.glb'), 'test');
    await until(() => messages.filter(m => m.type === 'full-reload').length > modelCount, 10000);

    const duplicate = spawn(process.execPath, ['scripts/dev.mjs', '--no-open'], { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] });
    let duplicateOutput = '';
    duplicate.stdout.on('data', text => { duplicateOutput += text; });
    duplicate.stderr.on('data', text => { duplicateOutput += text; });
    await until(() => duplicate.exitCode !== null, 10000);
    assert.equal(duplicate.exitCode, 0, duplicateOutput);
    assert.match(duplicateOutput, /已经运行/);
    assert.equal((await status()).sessionId, first.sessionId);

    socket.close(); socket = null;
    // 编译过程中结束开发模式也应回收它创建的编译器和服务器。
    await writeFile(config, (await readFile(config, 'utf8')) + '\n// shutdown during rebuild\n');
    await until(async () => (await status()).state === 'building', 10000);
    controller.kill('SIGTERM');
    await until(() => controller.exitCode !== null, 15000);
    assert.equal(controller.exitCode, 0, output);
    await assert.rejects(fetch(fixed.apiUrl + 'api/health'));
    await assert.rejects(access(path.join(fixture, 'server/build/dev/session.json')));
  } catch (error) {
    error.message += '\n开发服务日志：\n' + output.slice(-16000);
    throw error;
  } finally {
    socket?.close();
    if (controller && controller.exitCode === null) {
      controller.kill('SIGTERM');
      await until(() => controller.exitCode !== null, 15000).catch(() => { controller.kill('SIGKILL'); });
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
