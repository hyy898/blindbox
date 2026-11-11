/**
 * Playwright 测试（真实浏览器 + 真实 C++ 服务器）
 * 启动 server/blindbox-server 提供 dist/ 网页，用真实点击走一遍：
 *   开盒 → 三个按钮（放进展柜 / 放入仓库 / 卖掉）→ 点空白进仓库 → 仓库重新打开卖掉
 *   → 展柜点开只能放回仓库 → 收集进度 x/21 → 刷新后存档还在 → 21 个集齐出通关画面
 *   → 直接打开 index.html 显示"请双击 启动游戏.bat 运行"
 *
 * 用法：npm test          （= vite build && node tests/play.mjs）
 *       node tests/play.mjs [服务器可执行文件] [网页目录]
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const exe = process.argv[2] || join(root, 'server', 'blindbox-server');
const web = process.argv[3] || join(root, 'dist');
const shots = process.argv.includes('--shots');
const PORT = 9411;
const base = `http://127.0.0.1:${PORT}`;
const results = {};
const ok = (name, pass, extra = {}) => {
  results[name] = { pass, ...extra };
  console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(extra).slice(0, 300));
};

if (!existsSync(exe)) { console.error('找不到服务器:', exe); process.exit(2); }
const db = join(mkdtempSync(join(tmpdir(), 'bbsrv-')), 'save.db');
const srv = spawn(exe, ['--port', String(PORT), '--web', web, '--db', db, '--seed', '42'], { stdio: 'pipe' });
for (let i = 0; i < 50; i++) {
  try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files']
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const errs = [];
async function open(url, { waitGame = true } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(url);
  if (waitGame) await page.waitForFunction(() => window.game && window.__blindbox, null, { timeout: 15000 });
  return page;
}
const serverState = (page) => page.evaluate(async () => {
  const r = await fetch('./api/state');
  return r.json();
});
const visibleButtons = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#sc-actions button')].filter(b => b.style.display !== 'none').map(b => b.id));
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(root, 'screens', name) }); };

try {
  // ---------- 启动 ----------
  const page = await open(base + '/');
  const boot = await page.evaluate(() => ({
    ready: document.body.classList.contains('ready'),
    coins: game.getState().coins,
    buttons: [...document.querySelectorAll('.buy-btn')].map(b => b.textContent.trim()),
    text: document.body.innerText
  }));
  ok('boot', boot.ready && boot.coins === 500 && boot.buttons.length === 3, { buttons: boot.buttons });
  ok('three_box_prices', /100/.test(boot.buttons[0]) && /200/.test(boot.buttons[1]) && /400/.test(boot.buttons[2]), { buttons: boot.buttons });
  ok('no_online_offline_wording', !/联网|单机/.test(boot.text));
  const chrome = await page.evaluate(() => ({
    recordsTab: !!document.querySelector('[data-tab="records"]'),
    badge: !!document.getElementById('player-badge'),
    tabs: [...document.querySelectorAll('.tabs button')].map(b => b.textContent.trim())
  }));
  ok('no_records_tab_or_nickname', !chrome.recordsTab && !chrome.badge && !chrome.tabs.includes('记录'), chrome);
  await shot(page, 'v4_01_shop.png');

  // ---------- 开盒 → 三个按钮 → 放进展柜 ----------
  await page.click('.buy-btn[data-sid="weird-appliances"]');
  await page.waitForFunction(() => showcase.isVisible(), null, { timeout: 10000 });
  const btns = await visibleButtons(page);
  ok('new_figure_three_buttons', btns.join() === 'sc-showcase-btn,sc-storage-btn,sc-sell-btn', { btns });
  await shot(page, 'v4_02_open.png');
  const first = await page.evaluate(() => game.getPending());
  await page.click('#sc-showcase-btn');
  await page.waitForFunction(() => !showcase.isVisible());
  let r = await serverState(page);
  ok('ui_to_showcase', r.state.coins === 100 && r.state.showcase['weird-appliances'][first.itemId] && r.progress.owned === 1, { coins: r.state.coins });

  // ---------- 放入仓库按钮 ----------
  await page.click('.buy-btn[data-sid="midnight-snack"]');
  await page.waitForFunction(() => showcase.isVisible(), null, { timeout: 10000 });
  await page.click('#sc-storage-btn');
  await page.waitForFunction(() => !showcase.isVisible());
  r = await serverState(page);
  ok('ui_storage_button', r.state.storage.length === 1 && !r.state.pending && r.state.coins === 0);

  // ---------- 仓库 → 重新打开 → 卖掉 ----------
  await page.click('.tabs button[data-tab="storage"]');
  await page.click('.storage-card');
  await page.waitForFunction(() => showcase.isVisible());
  const price = await page.evaluate(() => game.sellPrice(game.getPending().itemId));
  await page.click('#sc-sell-btn');
  await page.waitForFunction(() => !showcase.isVisible());
  await page.waitForTimeout(150);
  r = await serverState(page);
  // 卖完金币不够最便宜的盒子、仓库空 → 自动领补助
  ok('ui_reopen_and_sell', r.state.storage.length === 0 && r.state.coins >= price, { coins: r.state.coins, price });
  // 卖完 coins < 100、仓库空 → 界面自动领破产补助
  if (price < 100) {
    await page.waitForFunction(() => game.getState().bailoutCount === 1, null, { timeout: 5000 }).catch(() => {});
    r = await serverState(page);
    ok('ui_auto_bailout', r.state.coins === price + 200 && r.state.bailoutCount === 1, { coins: r.state.coins });
  }

  // ---------- 点空白 → 仓库 ----------
  await page.click('.tabs button[data-tab="shop"]');
  await page.click('.buy-btn[data-sid="midnight-snack"]');
  await page.waitForFunction(() => showcase.isVisible(), null, { timeout: 10000 });
  const c = await page.locator('#sc-canvas').boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  const rot0 = await page.evaluate(() => showcase.getRotation());
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2 + 80, c.y + c.height / 2 + 20, { steps: 10 });
  await page.mouse.up();
  const rot1 = await page.evaluate(() => showcase.getRotation());
  ok('drag_rotates', Math.abs(rot1.y - rot0.y) > 0.2);
  await page.mouse.click(40, 40);
  await page.waitForFunction(() => !showcase.isVisible());
  r = await serverState(page);
  ok('ui_blank_to_storage', r.state.storage.length === 1 && !r.state.pending);

  // ---------- 展柜：进度 + 点开只能放回仓库 ----------
  await page.click('.tabs button[data-tab="case"]');
  const prog1 = await page.textContent('#progress-total');
  ok('progress_total_shown', /收集进度 1\/21/.test(prog1), { prog1 });
  const perSeries = await page.textContent('.progress-series');
  ok('progress_per_series', /深夜食堂 0\/7/.test(perSeries) && /怪奇家电 1\/7/.test(perSeries), { perSeries });
  await shot(page, 'v4_03_case.png');
  await page.click('.slot.owned');
  await page.waitForFunction(() => showcase.isVisible());
  const caseBtns = await visibleButtons(page);
  ok('case_view_only_storage_button', caseBtns.join() === 'sc-storage-btn', { caseBtns });
  await page.mouse.click(40, 40); // 点空白 = 关闭，不动存档
  await page.waitForFunction(() => !showcase.isVisible());
  r = await serverState(page);
  ok('case_blank_just_closes', r.progress.owned === 1);
  await page.click('.slot.owned');
  await page.waitForFunction(() => showcase.isVisible());
  await page.click('#sc-storage-btn');
  await page.waitForFunction(() => !showcase.isVisible());
  r = await serverState(page);
  ok('case_to_storage', r.progress.owned === 0 && r.state.storage.length === 2);
  ok('progress_updates', /0\/21/.test(await page.textContent('#progress-total')));

  // ---------- 刷新后存档还在 ----------
  const coinsBefore = r.state.coins;
  await page.reload();
  await page.waitForFunction(() => window.game && window.__blindbox);
  const after = await page.evaluate(() => ({ coins: game.getState().coins, storage: game.getState().storage.length }));
  ok('persist_after_reload', after.coins === coinsBefore && after.storage === 2, after);

  // ---------- 通关：21 个全进展柜 → 通关画面 ----------
  const sim = await page.evaluate(async () => {
    // 先把仓库里的放回展柜/卖掉，然后用接口快速开盒，只留最后 1 个新款给 UI
    for (const e of game.getState().storage) {
      await game.reopen(e.uid);
      const t = await game.toShowcase();
      if (!t.ok) await game.sellPending();
    }
    for (let i = 0; i < 3000; i++) {
      const st = game.getState();
      const prog = game.getProgress();
      const todo = game.data.series.filter(s => prog.bySeries[s.id].owned < prog.bySeries[s.id].total)
        .sort((a, b) => a.boxPrice - b.boxPrice);
      if (!todo.length) return { done: true };
      let sid = st.coins >= todo[0].boxPrice ? todo[0].id : (st.coins >= 100 ? 'midnight-snack' : null);
      if (!sid) { await game.maybeBailout(); continue; }
      const o = await game.open(sid);
      if (!o.ok) return { error: o.message };
      if (o.alreadyInShowcase) { await game.sellPending(); continue; }
      if (prog.owned === 20) { await game.toStorage(); return { last: o.entry.itemId, boxes: st.boxesOpened + 1 }; }
      await game.toShowcase();
    }
    return { error: 'too many' };
  });
  await page.click('.tabs button[data-tab="storage"]');
  await page.evaluate(() => window.__blindbox.render());
  await page.click(`.storage-card`);
  await page.waitForFunction(() => showcase.isVisible());
  await page.click('#sc-showcase-btn');
  await page.waitForFunction(() => document.getElementById('win-overlay').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
  const win = await page.evaluate(() => ({
    shown: document.getElementById('win-overlay').classList.contains('show'),
    text: document.getElementById('win-stats').textContent,
    won: game.getState().won, prog: game.getProgress().owned
  }));
  ok('win_screen_when_21', win.shown && win.won && win.prog === 21, { ...win, sim });
  await shot(page, 'v4_04_win.png');
  await page.click('#btn-win-close');

  await page.close();

  // ---------- 直接打开 index.html ----------
  const p3 = await open(pathToFileURL(join(web, 'index.html')).href, { waitGame: false });
  await p3.waitForTimeout(800);
  const boot3 = await p3.evaluate(() => ({ title: document.getElementById('boot-title').textContent,
    visible: getComputedStyle(document.getElementById('boot-msg')).display !== 'none' }));
  ok('file_open_shows_launcher_hint', boot3.visible && boot3.title === '请双击 启动游戏.bat 运行', boot3);
  await p3.close();

  // 构建产物里不应再有"联网/单机"字样
  const assetText = readdirSync(join(web, 'assets')).filter(f => f.endsWith('.js'))
    .map(f => readFileSync(join(web, 'assets', f), 'utf8')).join('');
  ok('no_online_offline_in_bundle', !/联网|单机/.test(assetText));

  const fatal = errs.filter(e => !/status of 404|net::ERR_FILE|ERR_FAILED|CORS|Failed to load module/i.test(e));
  ok('no_page_errors', fatal.length === 0, { fatal });
} finally {
  await browser.close();
  srv.kill();
}
const failed = Object.values(results).filter(r => !r.pass).length;
console.log(failed ? `FAILED ${failed}` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
