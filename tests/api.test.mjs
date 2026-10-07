import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.ts';
import { fixturePermits, SOURCES } from './permit-fixtures.ts';

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
  await postgres.exec(`CREATE TABLE public.permit_sources (
    id text PRIMARY KEY, name text, county text, endpoint text, connector_type text,
    connector_status text, enabled boolean, notes text, publication_cadence text, poll_interval_minutes integer
  );
  CREATE TABLE public.source_checkpoints (
    source_id text, last_success_at timestamptz, last_error_at timestamptz, newest_record_at timestamptz
  );
  CREATE TABLE public.permits (
    id uuid PRIMARY KEY, permit_number text, description text, address text, city text,
    county text, county_name text, dashboard_trade text, dashboard_status text, property_class text,
    issue_date date, application_date date, project_value numeric, status_raw text,
    source_id text, source_url text, record_url text, applicant_name text, applicant_company text,
    applicant_phone text, owner_name text, contractor_name text, contractor_phone text,
    business_names text[], contacts jsonb, first_seen_at timestamptz, last_seen_at timestamptz,
    last_changed_at timestamptz, source_updated_at timestamptz, has_listed_contact boolean
  );`);
  for (const source of SOURCES) {
    await postgres.query('INSERT INTO public.permit_sources VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [source.id, source.name, source.county, source.url, source.format, source.id === 'lake' ? 'blocked' : 'working', source.id !== 'lake', source.note, 'Published daily', 20]);
    if (source.id !== 'lake') await postgres.query('INSERT INTO public.source_checkpoints VALUES ($1,now(),NULL,now())', [source.id]);
  }
  for (const [index, permit] of fixturePermits().entries()) {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await postgres.query(`INSERT INTO public.permits (id,permit_number,description,address,city,county,county_name,
      dashboard_trade,dashboard_status,property_class,issue_date,application_date,project_value,status_raw,
      source_id,source_url,record_url,applicant_name,applicant_company,applicant_phone,business_names,contacts,
      first_seen_at,last_seen_at,last_changed_at,source_updated_at,has_listed_contact)
      VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18,$19,$20,$21,$21,$21,$21,$22)`,
      [id, `TEST-${index + 1}`, permit.description, permit.address, permit.city, permit.county, permit.trade, permit.status,
        permit.propertyType.toLowerCase(), permit.issuedAt.slice(0, 10), permit.appliedAt.slice(0, 10), permit.value,
        permit.rawStatus, permit.sourceId, permit.sourceUrl, permit.contactName, permit.businessName, permit.phone,
        [permit.businessName], JSON.stringify(permit.contactName ? [{ role: 'applicant', name: permit.contactName, phone: permit.phone }] : []),
        permit.firstSeenAt, !!permit.phone]);
  }
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
  assert.equal((await (await request('/api/workspace')).json()).backendConnected, true);
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
  assert.equal((await request('/api/leads', { method: 'POST', requestOrigin: 'https://another.test', body: { updates: [{ id: '00000000-0000-4000-8000-000000000001', status: 'saved' }] } })).status, 403);
  const all = await (await request('/api/permits?pageSize=10')).json();
  assert.equal(all.total, 36); assert.equal(all.permits.length, 10); assert.equal(all.mode, 'live');
  const filtered = await (await request('/api/permits?county=Orange&trade=HVAC&age=today&propertyType=Commercial')).json();
  assert.equal(filtered.total, 1);
});
test('database filters and ordering run before pagination, with stable IDs', async () => {
  const first = await (await request('/api/permits?county=Orange&pageSize=1&sort=value')).json();
  const second = await (await request('/api/permits?county=Orange&pageSize=1&sort=value&page=2')).json();
  assert.ok(first.total > 1);
  assert.equal(second.total, first.total);
  assert.equal(first.permits.length, 1);
  assert.ok(first.permits[0].value > second.permits[0].value);
  assert.notEqual(first.permits[0].id, second.permits[0].id);
  assert.equal(first.permits[0].demo, false);
  const detail = await (await request(`/api/permits/${first.permits[0].id}`)).json();
  assert.equal(detail.permit.businessName, first.permits[0].businessName);
  assert.equal(detail.permit.contactRole, 'Applicant');
  assert.equal((await request('/api/permits/not-a-record')).status, 404);
  assert.equal((await (await request('/api/permits?q=%27%20OR%201%3D1%20--')).json()).total, 0);
});
test('indexed filters preserve fallback fields, private sales states and global counts', async () => {
  const { normalizePermit } = await import('../server/data.ts');
  const { scorePermit, matchesFilters, comparePermits, summarize } = await import('../lib/permit-utils.ts');
  const { DEFAULT_FILTERS, DEFAULT_PROFILE } = await import('../lib/types.ts');
  const profile = { ...DEFAULT_PROFILE, trades: ['HVAC'], counties: ['Orange'], minimumValue: 50000 };
  const states = {
    '00000000-0000-4000-8000-000000000001': { status: 'saved', notes: 'Keep this note' },
    '00000000-0000-4000-8000-000000000002': { status: 'dismissed', notes: '' },
    '00000000-0000-4000-8000-000000000003': { status: 'contacted', notes: '' },
  };
  await postgres.exec('BEGIN');
  try {
    await request('/api/profile', { method: 'POST', body: profile });
    await postgres.exec(`UPDATE public.permits SET county_name='', county='Orange County',
      dashboard_trade='', dashboard_status=NULL, property_class=NULL
      WHERE id='00000000-0000-4000-8000-000000000001'`);
    for (const [id, state] of Object.entries(states)) await postgres.query(
      'INSERT INTO permitline_dashboard.lead_states VALUES ($1,$2,$3,$4,$5)',
      ['test-owner', id, state.status, state.notes, Date.now()]);
    const raw = await postgres.query('SELECT p.*, p.issue_date::text AS issue_date, p.application_date::text AS application_date, s.name AS source_name FROM public.permits p LEFT JOIN public.permit_sources s ON s.id=p.source_id');
    const all = raw.rows.map(row => scorePermit(normalizePermit(row), profile));
    const cases = [
      { county: 'Orange', sort: 'value' },
      { county: 'Orange', trade: 'General contracting', status: 'Unknown', propertyType: 'Unknown' },
      { trade: 'HVAC', status: 'open', age: 'week', sort: 'priority' },
      { onlyServiceArea: true, minimumValue: 30000 },
      { age: 'today' }, { age: 'yesterday' }, { age: 'two-days' }, { age: 'older', sort: 'oldest' },
      { q: 'Cafe', hideDismissed: false }, { leadStatus: 'new' },
      { view: 'saved' }, { view: 'saved', leadStatus: 'contacted' },
    ];
    for (const overrides of cases) {
      const filters = { ...DEFAULT_FILTERS, ...overrides };
      const expected = all.filter(permit => matchesFilters(permit, filters, profile, states, overrides.view === 'saved'))
        .sort((a, b) => comparePermits(a, b, filters.sort));
      const params = new URLSearchParams(Object.entries({ ...overrides, pageSize: 2, page: 2 }).map(([key, value]) => [key, String(value)]));
      const response = await request('/api/permits?' + params);
      assert.equal(response.status, 200, JSON.stringify(overrides));
      const actual = await response.json();
      assert.equal(actual.total, expected.length, JSON.stringify(overrides));
      assert.deepEqual(actual.permits.map(permit => permit.id), expected.slice(2, 4).map(permit => permit.id), JSON.stringify(overrides));
      assert.deepEqual(actual.stats, summarize(all), JSON.stringify(overrides));
    }
  } finally { await postgres.exec('ROLLBACK'); }
});
test('source health and missing or empty feeds never return demo permits', async () => {
  const sources = await (await request('/api/sources')).json();
  assert.equal(sources.mode, 'live');
  assert.equal(sources.sources.find(s => s.id === 'orlando').status, 'healthy');
  assert.equal(sources.sources.find(s => s.id === 'lake').status, 'error');
  await postgres.exec('BEGIN; DELETE FROM public.permits;');
  try {
    const empty = await (await request('/api/permits')).json();
    assert.equal(empty.total, 0); assert.deepEqual(empty.permits, []); assert.equal(empty.mode, 'live');
  } finally { await postgres.exec('ROLLBACK'); }
  await postgres.exec('ALTER TABLE public.permits RENAME TO unavailable_permits');
  try {
    const missing = await request('/api/permits');
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /collector tables/i);
    assert.equal((await (await request('/api/workspace')).json()).backendConnected, false);
  } finally { await postgres.exec('ALTER TABLE public.unavailable_permits RENAME TO permits'); }
});
test('a missing optional API token uses the existing database connection', async () => {
  process.env.PERMIT_API_URL = 'https://collector.example.test';
  delete process.env.PERMIT_API_TOKEN;
  try { assert.equal((await (await request('/api/permits')).json()).total, 36); }
  finally { delete process.env.PERMIT_API_URL; }
});
test('full CSV uses matching records beyond one page and reports its limit', async () => {
  await postgres.exec('BEGIN');
  try {
    for (let i = 0; i < 60; i++) await postgres.query(`INSERT INTO public.permits
      (id,source_id,permit_number,dashboard_trade,dashboard_status,property_class,issue_date,county,county_name,first_seen_at,last_seen_at)
      VALUES ($1,'orlando',$2,'HVAC','Issued','commercial',current_date,'Orange','Orange',now(),now())`,
      [`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`, `EXPORT-TEST-${i}`]);
    const exported = await request('/api/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get('X-Exported-Rows'), '96');
    assert.equal(exported.headers.get('X-Total-Matching'), '96');
    assert.match(await exported.text(), /EXPORT-TEST-59/);
    const limited = await request('/api/export?limit=5&county=Orange');
    assert.equal(limited.headers.get('X-Exported-Rows'), '5');
    assert.ok(Number(limited.headers.get('X-Total-Matching')) > 5);
    assert.equal(limited.headers.get('X-Export-Limit'), '5');
  } finally { await postgres.exec('ROLLBACK'); }
});
test('partial sales-state updates preserve notes in Postgres and CSV', async () => {
  assert.equal((await request('/api/leads', { method: 'POST', body: { updates: [{ id: '00000000-0000-4000-8000-000000000001', status: 'saved', notes: 'Local database test note.' }] } })).status, 200);
  assert.equal((await request('/api/leads', { method: 'POST', body: { updates: [{ id: '00000000-0000-4000-8000-000000000001', status: 'contacted' }] } })).status, 200);
  const workspace = await (await request('/api/workspace')).json();
  assert.equal(workspace.leads['00000000-0000-4000-8000-000000000001'].notes, 'Local database test note.');
  const csv = await (await request('/api/export?view=saved')).text(); assert.match(csv, /Local database test note/);
});
test('preferences persist and unconfigured Jev returns an explicit error', async () => {
  assert.equal((await request('/api/profile', { method: 'POST', body: { company: 'Test business', trades: ['HVAC'], counties: ['Orange'], commercialOnly: true, minimumValue: 0, jevEnabled: false } })).status, 200);
  const response = await request('/api/jev/assess', { method: 'POST', body: { ids: ['00000000-0000-4000-8000-000000000001'] } }); assert.equal(response.status, 409);
});
test('Jev page reads use constant database round trips and isolate fresh assessments', async context => {
  const { assessmentInput } = await import('../server/data.ts');
  const { sha256 } = await import('../lib/password.ts');
  process.env.AIMLAPI_KEY = 'test-only-aiml-key';
  context.mock.method(globalThis, 'fetch', async () => { throw new Error('Listing permits must not call the paid model.'); });
  await postgres.exec('BEGIN');
  try {
    const profile = { ...(await (await request('/api/workspace')).json()).profile, jevEnabled: true };
    assert.equal((await request('/api/profile', { method: 'POST', body: profile })).status, 200);
    await postgres.exec(`INSERT INTO public.permits
      (id,source_id,permit_number,dashboard_trade,dashboard_status,property_class,issue_date,county,county_name,first_seen_at,last_seen_at)
      SELECT ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'orlando', 'BATCH-TEST-'||n,
        'HVAC','Issued','commercial',(now() AT TIME ZONE 'America/New_York')::date,'Orange','Orange',now(),now()
      FROM generate_series(1,20) n`);
    await postgres.exec(`INSERT INTO permitline_dashboard.workspace_accounts (user_id,password_hash,password_salt,created_at)
      SELECT 'another-owner',password_hash,password_salt,created_at FROM permitline_dashboard.workspace_accounts WHERE user_id='test-owner'`);
    const queries = [], original = postgres.query.bind(postgres);
    context.mock.method(postgres, 'query', async (...args) => { queries.push(args[0]); return original(...args); });
    const small = await (await request('/api/permits?pageSize=1')).json();
    assert.equal(small.permits.length, 1);
    const smallQueryCount = queries.length;
    queries.length = 0;
    const large = await (await request('/api/permits?pageSize=50')).json();
    assert.equal(large.permits.length, 50);
    assert.equal(queries.length, smallQueryCount, 'Increasing the page size must not add database round trips.');
    assert.equal(queries.filter(query => /from "permitline_dashboard"\."jev_assessments"/i.test(query)).length, 1);
    assert.equal(queries.filter(query => /from "permitline_dashboard"\."lead_states"/i.test(query)).length, 0, 'The page query already filters saved states.');
    const [fresh, otherOwner, outdated, malformed] = large.permits;
    const assessment = { score: 95, confidence: 0.9, trade: 'HVAC', model: 'test-cached-model', assessedAt: new Date().toISOString() };
    for (const [permit, owner, hash, payload] of [
      [fresh, 'test-owner', await sha256(assessmentInput(fresh, profile)), JSON.stringify(assessment)],
      [otherOwner, 'another-owner', await sha256(assessmentInput(otherOwner, profile)), JSON.stringify(assessment)],
      [outdated, 'test-owner', 'outdated-input', JSON.stringify(assessment)],
      [malformed, 'test-owner', await sha256(assessmentInput(malformed, profile)), '{invalid-json'],
    ]) await postgres.query('INSERT INTO permitline_dashboard.jev_assessments VALUES ($1,$2,$3,$4,$5)', [owner, permit.id, hash, payload, Date.now()]);
    const repeated = await (await request('/api/permits?pageSize=50')).json();
    assert.deepEqual(repeated.permits.find(permit => permit.id === fresh.id).assessment, assessment);
    assert.equal(repeated.permits.find(permit => permit.id === fresh.id).priority, 95);
    for (const permit of [otherOwner, outdated, malformed]) assert.equal(repeated.permits.find(row => row.id === permit.id).assessment, undefined);
    queries.length = 0;
    const empty = await (await request('/api/permits?q=unmatched-batch-query')).json();
    assert.equal(empty.permits.length, 0);
    assert.equal(queries.filter(query => /from "permitline_dashboard"\."jev_assessments"/i.test(query)).length, 0);
  } finally { await postgres.exec('ROLLBACK'); delete process.env.AIMLAPI_KEY; }
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
    const permit = (await (await request('/api/permits/00000000-0000-4000-8000-000000000001')).json()).permit;
    const oldState = JSON.parse(assessmentInput(permit, workspace.profile));
    delete oldState.assessmentVersion;
    await postgres.query('INSERT INTO permitline_dashboard.jev_assessments (user_id, permit_id, input_hash, payload, created_at) VALUES ($1,$2,$3,$4,$5)', ['test-owner', '00000000-0000-4000-8000-000000000001', await sha256(JSON.stringify(oldState)), JSON.stringify({ score: 1, model: 'previous-provider' }), Date.now()]);
    assert.equal((await request('/api/jev/assess', { method: 'POST', session: null, body: { ids: ['00000000-0000-4000-8000-000000000001'] } })).status, 401);
    const response = await request('/api/jev/assess', { method: 'POST', body: { ids: ['00000000-0000-4000-8000-000000000001'] } });
    assert.equal(response.status, 200);
    const result = (await response.json()).assessments['00000000-0000-4000-8000-000000000001'];
    assert.equal(result.model, 'typesafe/jev-1.13-20260917');
    assert.equal(result.confidence, 0.91);
    assert.equal(result.trade, 'HVAC');
    assert.ok(Number.isInteger(result.score) && result.score > 70 && result.score <= 100);
    const repeat = await (await request('/api/jev/assess', { method: 'POST', body: { ids: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'] } })).json();
    assert.deepEqual(repeat.assessments['00000000-0000-4000-8000-000000000001'], result);
    assert.equal(calls, 1);
    const detail = (await (await request('/api/permits/00000000-0000-4000-8000-000000000001')).json()).permit;
    assert.equal(detail.priority, result.score);
    assert.equal(detail.assessment.model, result.model);
    assert.equal((await request('/api/profile', { method: 'POST', body: profile })).status, 200);
  } finally { delete process.env.AIMLAPI_KEY; }
});
test('AI/ML provider errors do not create a cached decision', async context => {
  process.env.AIMLAPI_KEY = 'test-only-aiml-key';
  context.mock.method(globalThis, 'fetch', async () => new Response('Provider refused the request', { status: 401 }));
  try {
    const response = await request('/api/jev/assess', { method: 'POST', body: { ids: ['00000000-0000-4000-8000-000000000002'] } });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Jev/);
    const rows = await postgres.query("SELECT permit_id FROM permitline_dashboard.jev_assessments WHERE permit_id='00000000-0000-4000-8000-000000000002'");
    assert.equal(rows.rows.length, 0);
  } finally { delete process.env.AIMLAPI_KEY; }
});
test('out-of-range AI/ML scores are refused instead of saved', async context => {
  process.env.AIMLAPI_KEY = 'test-only-aiml-key';
  context.mock.method(globalThis, 'fetch', async () => Response.json({ model: 'typesafe/jev', answers: {
    service_fit: { score: 5, confidence: 0.9 }, scope_clarity: { score: 1 }, trade: { choice: 'HVAC' },
  } }));
  try {
    assert.equal((await request('/api/jev/assess', { method: 'POST', body: { ids: ['00000000-0000-4000-8000-000000000003'] } })).status, 502);
    const rows = await postgres.query("SELECT permit_id FROM permitline_dashboard.jev_assessments WHERE permit_id='00000000-0000-4000-8000-000000000003'");
    assert.equal(rows.rows.length, 0);
  } finally { delete process.env.AIMLAPI_KEY; }
});
test('sessions and notes survive a database restart', async () => {
  await postgres.close(); postgres = new PGlite(directory); database = drizzle(postgres, { schema });
  const workspace = await (await request('/api/workspace')).json();
  assert.equal(workspace.profile.company, 'Test business'); assert.equal(workspace.leads['00000000-0000-4000-8000-000000000001'].status, 'contacted');
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
