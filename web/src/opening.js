// 结果先展示，纸盒动画与模型加载继续进行；下一步操作可以立即中断动画。
export function startOpeningSequence({ element, reducedMotion = false, isActive = () => true,
  startViewer, onModelStatus = () => {}, onReveal, onFinish,
  getStyle = globalThis.getComputedStyle, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout }) {
  let finished = false, disposed = false, timer;
  const cleanup = () => {
    clearTimer(timer);
    element?.removeEventListener('animationend', ended);
    element?.removeEventListener('animationcancel', ended);
  };
  const finish = () => {
    if (disposed || finished) return;
    cleanup();
    if (!isActive()) return;
    finished = true;
    onFinish();
  };
  const ended = event => {
    if (event.target === element && event.animationName === 'qiwu-package-away') finish();
  };
  const report = kind => { if (!disposed && isActive()) onModelStatus(kind); };
  const controls = {
    skip: finish,
    run(action) {
      if (disposed || !isActive()) return;
      finish();
      if (!disposed && isActive()) return action();
    },
    dispose() { disposed = true; cleanup(); }
  };
  if (!isActive()) { disposed = true; return controls; }
  onReveal();
  element?.addEventListener('animationend', ended);
  element?.addEventListener('animationcancel', ended);

  // 动画事件是主信号；隐藏页、样式关闭动画时按实际 CSS 时长兜底。
  let duration = 0;
  if (element && !reducedMotion) {
    const style = getStyle(element);
    const names = style.animationName.split(',').map(value => value.trim());
    const index = names.indexOf('qiwu-package-away');
    const milliseconds = value => (parseFloat(value) || 0) * (value.trim().endsWith('ms') ? 1 : 1000);
    const times = key => style[key].split(',').map(milliseconds);
    if (index >= 0) {
      const durations = times('animationDuration'), delays = times('animationDelay');
      duration = Math.max(0, durations[index % durations.length] + delays[index % delays.length]);
    }
  }
  if (duration > 0) timer = setTimer(finish, duration + 50);

  try { Promise.resolve(startViewer(report)).catch(() => report('error')); }
  catch { report('error'); }
  if (duration === 0) finish();
  return controls;
}
