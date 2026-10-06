import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.ts';

const directory = mkdtempSync(path.join(tmpdir(), 'permitline-postgres-test-'));
const origin = 'https://permitline.test';
const password = 'test-only-private-password';
process.env.DATABASE_URL = 'postgres://test-only@localhost/test-only';
process.env.WORKSPACE_ID = 'test-owner';
process.env.WORKSPACE_PASSWORD = password;
delete process.env.PERMIT_API_URL;
delete process.env.AIMLAPI_KEY;
let postgres, database, handler, cookie;

before(async () => {
  postgres = new PGlite(directory);
  await postgres.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await postgres.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  database = drizzle(postgres, { schema });
  mock.module(new URL('../db/index.ts', import.meta.url).href, { namedExports: { getDb: () => database } });
  handler = await import('../app/api/[...path]/route.ts');
});
after(async () => { if (postgres) await postgres.close(); mock.restoreAll(); rmSync(directory, { recursive: true, force: true }); });
async function request(route, { method = 'GET', body, session = cookie, requestOrigin = origin, headers = {} } = {}) {
  const allHeaders = { ...headers };
  if (session) allHeaders.Cookie = session;
  if (body !== undefined) { allHeaders['Content-Type'] = 'application/json'; allHeaders.Origin = requestOrigin; }
  const value = new Request(origin + route, { method, headers: allHeaders, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return handler[method](value);
}

test('public visitors cannot create a password or bypass access with ChatGPT headers', async () => {
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: { password }, session: null })).status, 403);
  assert.equal((await request('/api/permits', { session: null, headers: { 'oai-authenticated-user-id': 'test-owner', 'oai-authenticated-user-email': 'owner@example.test' } })).status, 401);
  const status = await (await request('/api/auth/status', { session: null })).json();
  assert.equal(status.setupRequired, false); assert.equal(status.unlocked, false);
});
test('first login uses the configured password and stores only its salted hash', async () => {
  const response = await request('/api/auth/login', { method: 'POST', body: { password }, session: null });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly/); assert.match(response.headers.get('set-cookie'), /Secure/);
  const result = await postgres.query('SELECT password_hash FROM permitline_dashboard.workspace_accounts');
  assert.notEqual(result.rows[0].password_hash, password); assert.equal(result.rows[0].password_hash.length, 64);
  assert.equal((await request('/api/workspace')).status, 200);
});
test('Postgres schema is idempotent and blocks client database roles', async () => {
  await postgres.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const tables = await postgres.query("SELECT relrowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid=pg_class.relnamespace WHERE nspname='permitline_dashboard' AND relkind='r'");
  assert.equal(tables.rows.length, 5); assert.ok(tables.rows.every(row => row.relrowsecurity));
  for (const role of ['anon', 'authenticated']) {
    await postgres.exec(`SET ROLE ${role}`);
    try { await assert.rejects(postgres.query('SELECT * FROM permitline_dashboard.workspace_accounts'), /permission denied/); }
    finally { await postgres.exec('RESET ROLE'); }
  }
});
test('cross-origin writes are rejected and authenticated filtering works', async () => {
  assert.equal((await request('/api/leads', { method: 'POST', requestOrigin: 'https://another.test', body: { updates: [{ id: 'demo-001', status: 'saved' }] } })).status, 403);
  const all = await (await request('/api/permits?pageSize=10')).json();
  assert.equal(all.total, 36); assert.equal(all.permits.length, 10); assert.equal(all.mode, 'demo');
  const filtered = await (await request('/api/permits?county=Orange&trade=HVAC&age=today&propertyType=Commercial')).json();
  assert.equal(filtered.total, 1);
});
test('partial sales-state updates preserve notes in Postgres and CSV', async () => {
  assert.equal((await request('/api/leads', { method: 'POST', body: { updates: [{ id: 'demo-001', status: 'saved', notes: 'Local database test note.' }] } })).status, 200);
  assert.equal((await request('/api/leads', { method: 'POST', body: { updates: [{ id: 'demo-001', status: 'contacted' }] } })).status, 200);
  const workspace = await (await request('/api/workspace')).json();
  assert.equal(workspace.leads['demo-001'].notes, 'Local database test note.');
  const csv = await (await request('/api/export?view=saved')).text(); assert.match(csv, /Local database test note/);
});
test('preferences persist and unconfigured Jev returns an explicit error', async () => {
  assert.equal((await request('/api/profile', { method: 'POST', body: { company: 'Test business', trades: ['HVAC'], counties: ['Orange'], commercialOnly: true, minimumValue: 0, jevEnabled: false } })).status, 200);
  const response = await request('/api/jev/assess', { method: 'POST', body: { ids: ['demo-001'] } }); assert.equal(response.status, 409);
});
test('Jev uses AI/ML API with typed questions and reuses a cached assessment', async context => {
  process.env.AIMLAPI_KEY = 'test-only-aiml-key';
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.aimlapi.com/v1/decisions');
    assert.equal(options.headers.Authorization, 'Bearer test-only-aiml-key');
    const input = JSON.parse(options.body);
    assert.equal(input.model, 'typesafe/jev');
    const state = JSON.parse(input.state);
    assert.deepEqual(state.profile.trades, ['HVAC']);
    assert.equal(input.questions.service_fit.type, 'score');
    assert.equal(input.questions.service_fit.criteria.length, 5);
    assert.equal(input.questions.scope_clarity.criteria.length, 3);
    assert.equal(input.questions.trade.type, 'choice');
    assert.ok(input.questions.trade.criteria.HVAC);
    return Response.json({ model: 'typesafe/jev-1.13-20260917', answers: {
      service_fit: { type: 'score', score: 3.5, confidence: 0.91 },
      scope_clarity: { type: 'score', score: 1.25, confidence: 0.8 },
      trade: { type: 'choice', choice: 'HVAC', confidence: 0.97 },
    }, usage: { input_tokens: 100, output_tokens: 0 } });
  });
  try {
    const profile = (await (await request('/api/workspace')).json()).profile;
    assert.equal((await request('/api/profile', { method: 'POST', body: { ...profile, jevEnabled: true } })).status, 200);
    const workspace = await (await request('/api/workspace')).json();
    assert.equal(workspace.jevConnected, true);
    assert.ok(!JSON.stringify(workspace).includes(process.env.AIMLAPI_KEY));
    // A cached decision from the previous provider must not suppress the AI/ML call.
    const { assessmentInput } = await import('../server/data.ts');
    const { sha256 } = await import('../lib/password.ts');
    const permit = (await (await request('/api/permits/demo-001')).json()).permit;
    const oldState = JSON.parse(assessmentInput(permit, workspace.profile));
    delete oldState.assessmentVersion;
    await postgres.query('INSERT INTO permitline_dashboard.jev_assessments (user_id, permit_id, input_hash, payload, created_at) VALUES ($1,$2,$3,$4,$5)', ['test-owner', 'demo-001', await sha256(JSON.stringify(oldState)), JSON.stringify({ score: 1, model: 'previous-provider' }), Date.now()]);
    assert.equal((await request('/api/jev/assess', { method: 'POST', session: null, body: { ids: ['demo-001'] } })).status, 401);
    const response = await request('/api/jev/assess', { method: 'POST', body: { ids: ['demo-001'] } });
    assert.equal(response.status, 200);
    const result = (await response.json()).assessments['demo-001'];
    assert.equal(result.model, 'typesafe/jev-1.13-20260917');
    assert.equal(result.confidence, 0.91);
    assert.equal(result.trade, 'HVAC');
    assert.ok(Number.isInteger(result.score) && result.score > 70 && result.score <= 100);
    const repeat = await (await request('/api/jev/assess', { method: 'POST', body: { ids: ['demo-001', 'demo-001'] } })).json();
    assert.deepEqual(repeat.assessments['demo-001'], result);
    assert.equal(calls, 1);
    const detail = (await (await request('/api/permits/demo-001')).json()).permit;
    assert.equal(detail.priority, result.score);
    assert.equal(detail.assessment.model, result.model);
    assert.equal((await request('/api/profile', { method: 'POST', body: profile })).status, 200);
  } finally { delete process.env.AIMLAPI_KEY; }
});
test('AI/ML provider errors do not create a cached decision', async context => {
  process.env.AIMLAPI_KEY = 'test-only-aiml-key';
  context.mock.method(globalThis, 'fetch', async () => new Response('Provider refused the request', { status: 401 }));
  try {
    const response = await request('/api/jev/assess', { method: 'POST', body: { ids: ['demo-002'] } });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Jev/);
    const rows = await postgres.query("SELECT permit_id FROM permitline_dashboard.jev_assessments WHERE permit_id='demo-002'");
    assert.equal(rows.rows.length, 0);
  } finally { delete process.env.AIMLAPI_KEY; }
});
test('out-of-range AI/ML scores are refused instead of saved', async context => {
  process.env.AIMLAPI_KEY = 'test-only-aiml-key';
  context.mock.method(globalThis, 'fetch', async () => Response.json({ model: 'typesafe/jev', answers: {
    service_fit: { score: 5, confidence: 0.9 }, scope_clarity: { score: 1 }, trade: { choice: 'HVAC' },
  } }));
  try {
    assert.equal((await request('/api/jev/assess', { method: 'POST', body: { ids: ['demo-003'] } })).status, 502);
    const rows = await postgres.query("SELECT permit_id FROM permitline_dashboard.jev_assessments WHERE permit_id='demo-003'");
    assert.equal(rows.rows.length, 0);
  } finally { delete process.env.AIMLAPI_KEY; }
});
test('sessions and notes survive a database restart', async () => {
  await postgres.close(); postgres = new PGlite(directory); database = drizzle(postgres, { schema });
  const workspace = await (await request('/api/workspace')).json();
  assert.equal(workspace.profile.company, 'Test business'); assert.equal(workspace.leads['demo-001'].status, 'contacted');
});
test('password changes revoke old sessions and keep the new session usable', async () => {
  const old = cookie;
  const response = await request('/api/auth/password', { method: 'POST', body: { currentPassword: password, password: 'changed-test-only-password' } }); assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/workspace', { session: old })).status, 401); assert.equal((await request('/api/workspace')).status, 200);
});
test('locking deletes the session and repeated wrong passwords trigger a persisted limit', async () => {
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await request('/api/permits')).status, 401);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await request('/api/auth/login', { method: 'POST', session: null, body: { password: 'wrong-test-only-password' } })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', session: null, body: { password: 'changed-test-only-password' } })).status, 429);
});
test('startup reveals a safe underlying connection code without leaking private error content', async context => {
  const secret = 'test-only-secret-that-must-not-be-logged';
  const cause = Object.assign(new Error(`Connection credentials: ${secret}`), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
  context.mock.method(database, 'select', () => { throw new Error(`Failed SQL containing ${secret}`, { cause }); });
  const logs = [];
  context.mock.method(console, 'error', (...args) => logs.push(args));
  const response = await request('/api/auth/status', { session: null });
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.errorCode, 'SELF_SIGNED_CERT_IN_CHAIN');
  assert.match(result.error, /DATABASE_CA_CERT/);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(logs).includes(secret));
  assert.match(JSON.stringify(logs), /SELF_SIGNED_CERT_IN_CHAIN/);
});
