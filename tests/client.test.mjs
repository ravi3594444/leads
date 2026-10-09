import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ClientError } from '../lib/client.ts';

function pending(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test('a stalled startup request stops at its deadline and can be retried', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, signal;
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    calls++; signal = options.signal;
    if (calls === 1) return pending(signal);
    return Response.json({ unlocked: false });
  });
  const first = api('/api/auth/status', { timeoutMs: 15000 });
  const failure = assert.rejects(first, error => error instanceof ClientError && error.status === 408 && /try again/i.test(error.message));
  context.mock.timers.tick(15000);
  await failure;
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.deepEqual(await api('/api/auth/status'), { unlocked: false });
  assert.equal(calls, 2);
});

test('the deadline also covers a response body that never finishes', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    signal = options.signal;
    return { ok: true, status: 200, json: () => pending(signal) };
  });
  const request = api('/api/workspace');
  await Promise.resolve();
  const failure = assert.rejects(request, error => error instanceof ClientError && error.status === 408);
  context.mock.timers.tick(20000);
  await failure;
  assert.equal(signal.aborted, true);
});

test('cancelling a replaced request keeps AbortError instead of showing a timeout', async context => {
  const controller = new AbortController();
  let signal;
  context.mock.method(globalThis, 'fetch', (path, options) => { signal = options.signal; return pending(signal); });
  const request = api('/api/permits', { signal: controller.signal });
  const failure = assert.rejects(request, { name: 'AbortError' });
  controller.abort();
  await failure;
  assert.equal(signal.aborted, true);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test('a completed request clears its deadline and keeps private request headers', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let options;
  context.mock.method(globalThis, 'fetch', async (path, init) => { options = init; return Response.json({ ok: true }); });
  await api('/api/profile', { method: 'POST', body: '{}', headers: new Headers({ 'X-Test': 'preserved' }) });
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers.get('Content-Type'), 'application/json');
  assert.equal(options.headers.get('X-Test'), 'preserved');
  context.mock.timers.tick(20000);
  assert.equal(options.signal.aborted, false);
});

test('a delayed write is not retried and tells the user to check its result', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.method(globalThis, 'fetch', (path, options) => pending(options.signal));
  const request = api('/api/leads', { method: 'POST', body: '{}' });
  const failure = assert.rejects(request, error => error.status === 408 && /check whether it completed/i.test(error.message));
  context.mock.timers.tick(20000);
  await failure;
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test('malformed successful responses fail clearly instead of becoming workspace data', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('<html>Gateway error</html>'));
  await assert.rejects(api('/api/workspace'), error => error instanceof ClientError && error.status === 502 && /read this response/i.test(error.message));
});

test('an unauthorized response locks the workspace even when its body is malformed', async context => {
  const previous = globalThis.window;
  const events = new EventTarget(); let locked = 0;
  globalThis.window = events;
  context.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  events.addEventListener('permitline:locked', () => locked++);
  context.mock.method(globalThis, 'fetch', async () => new Response('Unauthorized', { status: 401 }));
  await assert.rejects(api('/api/workspace'), error => error.status === 401);
  assert.equal(locked, 1);
  await assert.rejects(api('/api/auth/login'), error => error.status === 401);
  assert.equal(locked, 1);
});
