/**
 * 拍摄 v4.1 界面截图：真实 C++ 服务器 + headless Chromium，固定种子。
 * 用法：node tools/shots.mjs [服务器可执行文件] [网页目录]
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const exe = process.argv[2] || join(root, 'server', 'blindbox-server');
const web = process.argv[3] || join(root, 'dist');
const outDir = join(root, 'screens');
const PORT = 9511;
const base = `http://127.0.0.1:${PORT}`;
const SEED = '20261110';

if (!existsSync(exe)) { console.error('找不到服务器:', exe); process.exit(2); }
if (!existsSync(join(web, 'index.html'))) { console.error('找不到网页:', web); process.exit(2); }

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  const p = join(outDir, f);
  try { rmSync(p, { recursive: true, force: true }); } catch {}
}

const db = join(mkdtempSync(join(tmpdir(), 'bbshots-')), 'save.db');
const srv = spawn(exe, ['--port', String(PORT), '--web', web, '--db', db, '--seed', SEED], { stdio: 'pipe' });
for (let i = 0; i < 50; i++) {
  try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto(base + '/');
await page.waitForFunction(() => window.game && window.__blindbox, null, { timeout: 15000 });
await page.waitForTimeout(300);

const shot = async (name) => {
  const path = join(outDir, name);
  await page.screenshot({ path, type: 'png' });
  console.log('shot', name);
};

// ---------- 01 商店（三档价格） ----------
await shot('01-shop.png');

// ---------- 02-05 开箱四帧 + 06 展示三按钮 ----------
const opened = await page.evaluate(async () => {
  const res = await game.open('midnight-snack');
  return { ok: res.ok, name: res.item?.name, entry: res.entry };
});
if (!opened.ok) throw new Error('open failed for shots');
await page.evaluate(() => window.__blindbox.render());
await page.evaluate((name) => {
  const ov = document.getElementById('open-ov');
  const box = ov.querySelector('.box-big');
  const msg = ov.querySelector('.open-msg');
  ov.style.display = 'flex';
  box.textContent = '🎁';
  msg.textContent = '盒子在晃…';
  box.style.animation = 'shake 0.7s ease-in-out';
}, opened.name);
await page.waitForTimeout(200);
await shot('02-open-1.png');

await page.evaluate(() => {
  const ov = document.getElementById('open-ov');
  const box = ov.querySelector('.box-big');
  const msg = ov.querySelector('.open-msg');
  box.textContent = '📦';
  msg.textContent = '打开了！';
  box.style.animation = '';
});
await page.waitForTimeout(150);
await shot('03-open-2.png');

await page.evaluate((name) => {
  const ov = document.getElementById('open-ov');
  const box = ov.querySelector('.box-big');
  const msg = ov.querySelector('.open-msg');
  box.textContent = '✨';
  msg.textContent = name + ' 跳出来了！';
}, opened.name);
await page.waitForTimeout(150);
await shot('04-open-3.png');

await page.evaluate(() => { document.getElementById('open-ov').style.display = 'none'; });
await page.evaluate(async () => {
  const entry = game.getPending();
  const item = game.item(entry.itemId);
  await showcase.show(entry, item, game.rarityOf(entry.itemId), {
    mode: 'new',
    alreadyInShowcase: game.inShowcase(entry.seriesId, entry.itemId),
    sellPrice: game.sellPrice(entry.itemId)
  });
  showcase._drag(40, -8);
});
await page.waitForTimeout(400);
await shot('05-open-4.png');
await shot('06-reveal-buttons.png');

// 放入仓库，避免挡后续操作
await page.evaluate(async () => { await game.toStorage(); showcase.hide(); window.__blindbox.render(); });
await page.waitForTimeout(200);

// ---------- 07 展柜进度 x/21 ----------
const mid = await page.evaluate(async () => {
  for (const e of game.getState().storage) {
    await game.reopen(e.uid);
    const t = await game.toShowcase();
    if (!t.ok) await game.sellPending();
  }
  const targets = { 'midnight-snack': 5, 'working-animals': 4, 'weird-appliances': 3 };
  for (let i = 0; i < 3000; i++) {
    const prog = game.getProgress();
    if (prog.owned >= 12) break;
    const st = game.getState();
    const todo = game.data.series.filter(s => prog.bySeries[s.id].owned < (targets[s.id] ?? s.items.length))
      .sort((a, b) => a.boxPrice - b.boxPrice);
    if (!todo.length) break;
    let sid = st.coins >= todo[0].boxPrice ? todo[0].id : (st.coins >= 100 ? 'midnight-snack' : null);
    if (!sid) { await game.maybeBailout(); continue; }
    const o = await game.open(sid);
    if (!o.ok) break;
    if (o.alreadyInShowcase) await game.sellPending();
    else await game.toShowcase();
  }
  return game.getProgress();
});
await page.click('.tabs button[data-tab="case"]');
await page.evaluate(() => {
  window.__blindbox.render();
  const t = document.getElementById('toast');
  t.classList.remove('show'); t.style.display = 'none';
});
await page.waitForTimeout(300);
await shot('07-showcase-progress.png');
console.log('progress', mid);

// ---------- 08 通关画面 21/21 ----------
await page.evaluate(async () => {
  for (let i = 0; i < 4000; i++) {
    const prog = game.getProgress();
    if (prog.owned >= 21) break;
    const st = game.getState();
    const todo = game.data.series.filter(s => prog.bySeries[s.id].owned < prog.bySeries[s.id].total)
      .sort((a, b) => a.boxPrice - b.boxPrice);
    if (!todo.length) break;
    let sid = st.coins >= todo[0].boxPrice ? todo[0].id : (st.coins >= 100 ? 'midnight-snack' : null);
    if (!sid) { await game.maybeBailout(); continue; }
    const o = await game.open(sid);
    if (!o.ok) break;
    if (o.alreadyInShowcase) await game.sellPending();
    else await game.toShowcase();
  }
  window.__blindbox.showWin();
  window.__blindbox.render();
  const t = document.getElementById('toast');
  t.classList.remove('show'); t.style.display = 'none';
});
await page.waitForFunction(() => document.getElementById('win-overlay').classList.contains('show'));
await page.waitForTimeout(200);
await page.evaluate(() => {
  const t = document.getElementById('toast');
  t.classList.remove('show'); t.style.display = 'none';
});
await shot('08-win.png');

// ---------- 10 展柜全景 ----------
await page.click('#btn-win-close');
await page.click('.tabs button[data-tab="case"]');
await page.evaluate(() => {
  window.__blindbox.render();
  const t = document.getElementById('toast');
  t.classList.remove('show'); t.style.display = 'none';
});
await page.waitForTimeout(300);
await page.setViewportSize({ width: 1280, height: 980 });
await page.waitForTimeout(200);
await page.screenshot({ path: join(outDir, '10-showcase-full.png'), type: 'png', fullPage: false });
console.log('shot', '10-showcase-full.png');

// ---------- 09 稀有度对比 ----------
await page.setViewportSize({ width: 1280, height: 800 });
const rarityIds = ['ms-01', 'ms-04', 'ms-06', 'ms-07'];
for (const id of rarityIds) {
  await page.evaluate(async (iid) => {
    document.getElementById('win-overlay').classList.remove('show');
    const item = game.item(iid);
    await showcase.show({ seriesId: item.seriesId, itemId: iid }, item, game.rarityOf(iid), {
      mode: 'new', sellPrice: game.sellPrice(iid), alreadyInShowcase: false
    });
    showcase._drag(35, -6);
  }, id);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `_rarity_${id}.png`), type: 'png' });
  console.log('shot', `_rarity_${id}.png`);
}
await page.evaluate(() => showcase.hide());

await browser.close();
srv.kill();

execFileSync('python3', [join(root, 'tools', 'compose_rarity.py'), outDir], { stdio: 'inherit' });
console.log('done', outDir);
