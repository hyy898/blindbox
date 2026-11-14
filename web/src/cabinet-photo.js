import { themeFor } from './themes.js';

const WIDTH = 1800;
const HEIGHT = 1200;
const serif = '"Songti SC", "STSong", "Noto Serif SC", serif';
const sans = '"PingFang SC", "Microsoft YaHei", sans-serif';

function fillGradient(context, rectangle, stops, vertical = false) {
  const [x, y, width, height] = rectangle;
  const gradient = context.createLinearGradient(x, y, vertical ? x : x + width, vertical ? y + height : y);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);
}

function loadSnapshot(source, name) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`「${name}」的合影画面未能读取，请重新查看后再试。`));
    image.src = source;
  });
}

function centeredText(context, text, x, y, maximumWidth, size, color, family = sans) {
  let currentSize = size;
  context.font = `${currentSize}px ${family}`;
  while (context.measureText(text).width > maximumWidth && currentSize > 18) {
    context.font = `${--currentSize}px ${family}`;
  }
  context.fillStyle = color;
  context.textAlign = 'center';
  context.fillText(text, x, y, maximumWidth);
}

function drawBay(context, entry, image, position) {
  const x = 96 + position * 536;
  context.save();
  context.beginPath();
  context.rect(x, 270, 536, 718);
  context.clip();
  fillGradient(context, [x, 270, 536, 718], [[0, '#41261e'], [.5, '#6c4932'], [1, '#42281f']]);
  const light = context.createRadialGradient(x + 268, 292, 12, x + 268, 380, 460);
  light.addColorStop(0, '#ffd89a65');
  light.addColorStop(.5, '#edb97020');
  light.addColorStop(1, '#f7d6aa00');
  context.fillStyle = light;
  context.fillRect(x, 270, 536, 718);
  fillGradient(context, [x, 785, 536, 203], [[0, '#b08458'], [.18, '#8e603e'], [.55, '#65432e'], [1, '#4c2b21']], true);
  context.strokeStyle = '#edc48a55';
  context.beginPath();
  context.moveTo(x, 785);
  context.lineTo(x + 536, 785);
  context.stroke();
  if (image) {
    const scale = Math.min(492 / image.naturalWidth, 532 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, x + (536 - width) / 2, 298 + (532 - height) / 2, width, height);
  }
  context.fillStyle = '#23150e66';
  context.fillRect(x + 87, 856, 366, 101);
  fillGradient(context, [x + 84, 850, 366, 100], [[0, '#f6ebd7'], [1, '#e5d2b1']]);
  context.strokeStyle = '#c3a47c';
  context.strokeRect(x + 84.5, 850.5, 365, 99);
  centeredText(context, entry ? entry.name : `位置 ${String(position + 1).padStart(2, '0')}`, x + 267, 890, 326, 29, '#493026', serif);
  centeredText(context, entry ? entry.series : '留空', x + 267, 925, 326, 20, '#8a6a52');
  if (position > 0) {
    fillGradient(context, [x - 5, 270, 10, 718], [[0, '#321b14'], [.6, '#8c603c'], [1, '#3c2118']]);
  }
  context.restore();
}

/** Capture current rendered viewpoints only; never loads substitutes or changes inventory. */
export async function saveCabinetPhoto({ slots = [], index, views = [] }) {
  const entries = Array.from({ length: 3 }, (_, position) => {
    const slot = slots[position];
    if (!slot) return null;
    const item = index?.byId?.[slot.itemId];
    if (!item) throw new Error(`位置 ${position + 1} 的藏品信息未就绪，请刷新展柜后再试。`);
    let source;
    try { source = views[position]?.getImage?.(); } catch { /* Report the affected collectible below. */ }
    if (typeof source !== 'string' || !source.startsWith('data:image/png')) {
      throw new Error(`「${item.name}」尚未显示，暂不能保存合影。请等它加载完成，或先将该位置留空。`);
    }
    return { name: item.name, series: index.bySeries?.[item.seriesId]?.name || themeFor(item.seriesId).label, source };
  });
  if (!entries.some(Boolean)) throw new Error('先摆放一件藏品，再保存合影。');
  // Freeze all three images before the first await so rotation or navigation cannot mix moments.
  const images = await Promise.all(entries.map(entry => entry ? loadSnapshot(entry.source, entry.name) : null));
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器暂时无法生成合影，请稍后再试。');
  fillGradient(context, [0, 0, WIDTH, HEIGHT], [[0, '#faf2e5'], [1, '#eadbc3']], true);
  centeredText(context, '奇物百货', WIDTH / 2, 93, 900, 28, '#762d2b', serif);
  centeredText(context, '我的展柜', WIDTH / 2, 156, 900, 46, '#493026', serif);
  context.fillStyle = '#42291c28';
  context.fillRect(83, 225, 1650, 854);
  fillGradient(context, [72, 208, 1656, 846], [[0, '#482a1e'], [.02, '#93643d'], [.045, '#5c3725'], [.96, '#5c3725'], [.985, '#93643d'], [1, '#45271d']]);
  entries.forEach((entry, position) => drawBay(context, entry, images[position], position));
  fillGradient(context, [72, 208, 1656, 62], [[0, '#a47248'], [.11, '#754a32'], [1, '#48291e']], true);
  fillGradient(context, [72, 988, 1656, 66], [[0, '#b08151'], [.09, '#805335'], [1, '#563324']], true);
  centeredText(context, `${entries.filter(Boolean).length} 件陈列`, WIDTH / 2, 1133, 900, 22, '#8c7057');
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('合影未能生成，请再试一次。');
  const now = new Date();
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(value => String(value).padStart(2, '0')).join('');
  const filename = `奇物百货-展柜合影-${stamp}.png`;
  const url = URL.createObjectURL(blob);
  return { url, filename, width: WIDTH, height: HEIGHT };
}
