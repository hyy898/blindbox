import test from 'node:test';
import assert from 'node:assert/strict';
import { startOpeningSequence } from '../web/src/opening.js';

function fixture(extra = {}) {
  const element = new EventTarget(), statuses = [];
  let revealCount = 0, finishCount = 0, report, scheduled = null, delay;
  const sequence = startOpeningSequence({ element,
    onReveal: () => { revealCount++; }, onModelStatus: kind => statuses.push(kind),
    onFinish: () => { finishCount++; },
    startViewer: callback => { report = callback; callback('loading'); return new Promise(() => {}); },
    getStyle: () => ({ animationName: 'qiwu-package-away', animationDuration: '2.1s', animationDelay: '0s' }),
    setTimer: (callback, milliseconds) => { scheduled = callback; delay = milliseconds; return 1; },
    clearTimer: () => { scheduled = null; },
    ...extra
  });
  return { sequence, statuses, report: kind => report(kind), reveals: () => revealCount,
    finishes: () => finishCount,
    delay: () => delay, timeout: () => scheduled?.(),
    end(name = 'qiwu-package-away') {
      const event = new Event('animationend');
      Object.defineProperty(event, 'animationName', { value: name });
      element.dispatchEvent(event);
    }
  };
}

test('details appear at once while the paper animation and model are still running', () => {
  const f = fixture();
  assert.equal(f.reveals(), 1);
  assert.equal(f.finishes(), 0);
  assert.deepEqual(f.statuses, ['loading']);
  f.end('qiwu-face');
  assert.equal(f.finishes(), 0);
  f.end();
  assert.equal(f.finishes(), 1);
  assert.equal(f.reveals(), 1);
  assert.deepEqual(f.statuses, ['loading']);
  f.report('ready');
  assert.deepEqual(f.statuses, ['loading', 'ready']);
  assert.equal(f.reveals(), 1);
});

test('model readiness or failure never hides the already available details', () => {
  for (const status of ['ready', 'missing', 'error']) {
    const f = fixture();
    f.report(status);
    assert.equal(f.reveals(), 1);
    assert.equal(f.finishes(), 0);
    f.end();
    assert.equal(f.finishes(), 1);
  }
});

test('fallback follows the actual CSS duration and delay instead of waiting for the model', () => {
  const f = fixture({ getStyle: () => ({ animationName: 'other, qiwu-package-away',
    animationDuration: '100ms, .7s', animationDelay: '0s, .2s' }) });
  assert.equal(f.delay(), 950);
  assert.equal(f.reveals(), 1);
  assert.equal(f.finishes(), 0);
  f.timeout();
  assert.equal(f.finishes(), 1);
  f.end();
  assert.equal(f.finishes(), 1);
});

test('reduced motion and disabled CSS animations reveal immediately with slow models', () => {
  const reduced = fixture({ reducedMotion: true, getStyle: () => { throw new Error('No CSS timing needed'); } });
  assert.equal(reduced.reveals(), 1);
  assert.equal(reduced.finishes(), 1);
  assert.equal(reduced.delay(), undefined);
  const disabled = fixture({ getStyle: () => ({ animationName: 'none', animationDuration: '0s', animationDelay: '0s' }) });
  assert.equal(disabled.reveals(), 1);
  assert.equal(disabled.finishes(), 1);
});

test('a next action skips the animation and starts immediately without waiting for the model', async () => {
  const calls = [];
  const f = fixture({ onReveal: () => calls.push('details'), onFinish: () => calls.push('skip') });
  const result = f.sequence.run(() => { calls.push('store'); return Promise.resolve('stored'); });
  assert.deepEqual(calls, ['details', 'skip', 'store']);
  assert.equal(await result, 'stored');
  f.end();
  f.timeout();
  f.report('ready');
  assert.deepEqual(calls, ['details', 'skip', 'store'], 'late events cannot repeat the action');
});

test('a result action remains usable when the animation has already finished', () => {
  const f = fixture();
  f.end();
  let called = false;
  assert.equal(f.sequence.run(() => { called = true; return 'next'; }), 'next');
  assert.equal(called, true);
  assert.equal(f.finishes(), 1);
});

test('skip reveals once; closing a dialog prevents old timers and model callbacks from updating it', () => {
  const f = fixture();
  f.sequence.skip();
  f.end();
  f.timeout();
  assert.equal(f.reveals(), 1);
  assert.equal(f.finishes(), 1);
  f.sequence.dispose();
  f.report('ready');
  assert.deepEqual(f.statuses, ['loading']);
  const closed = fixture();
  closed.sequence.dispose();
  closed.end();
  closed.timeout();
  closed.sequence.skip();
  closed.sequence.run(() => assert.fail('a disposed dialog cannot act on a new result'));
  assert.equal(closed.reveals(), 1);
  assert.equal(closed.finishes(), 0);
});

test('a stale dialog cannot reveal a result after navigation', () => {
  let active = true;
  const f = fixture({ isActive: () => active });
  active = false;
  f.end();
  f.report('ready');
  f.sequence.run(() => assert.fail('a stale dialog cannot execute an action'));
  assert.equal(f.reveals(), 1);
  assert.equal(f.finishes(), 0);
  assert.deepEqual(f.statuses, ['loading']);
});
