import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { COUNTIES, DEFAULT_FILTERS, DEFAULT_PROFILE } from '../lib/types.ts';
import { fixturePermits } from './permit-fixtures.ts';
import { ageInDays, comparePermits, makeCsv, matchesFilters, scorePermit, summarize } from '../lib/permit-utils.ts';
import { constantTimeEqual, passwordHash, sessionCookie, sessionToken } from '../lib/password.ts';

const now = new Date('2026-10-05T18:00:00Z');
const permits = fixturePermits(now);

test('county choices cover 67 distinct Florida counties', () => {
  assert.equal(COUNTIES.length, 67);
  assert.equal(new Set(COUNTIES).size, 67);
});
test('permit age uses Florida calendar days across UTC midnight', () => {
  assert.equal(ageInDays('2026-10-05T02:00:00Z', now), 1);
  assert.equal(ageInDays('2026-10-05T13:00:00Z', now), 0);
  assert.equal(ageInDays(null, now), null);
});
test('permit age does not drift across daylight-saving transitions', () => {
  assert.equal(ageInDays('2026-11-01T04:30:00Z', new Date('2026-11-02T05:30:00Z')), 1);
});
test('sample permits keep the correct Florida day near UTC midnight', () => {
  const late = new Date('2026-10-06T02:00:00Z');
  assert.equal(ageInDays(fixturePermits(late)[0].issuedAt, late), 0);
});
test('open filters exclude unknown status even if an issue date exists', () => {
  const unknown = permits.find(p => p.status === 'Unknown');
  assert.ok(unknown.issuedAt);
  assert.equal(matchesFilters(unknown, { ...DEFAULT_FILTERS, status: 'open' }, DEFAULT_PROFILE, {}, false, now), false);
});
test('date, county, trade and property filters combine', () => {
  const filters = { ...DEFAULT_FILTERS, age: 'today', county: 'Orange', trade: 'HVAC', propertyType: 'Commercial' };
  const matches = permits.filter(p => matchesFilters(p, filters, DEFAULT_PROFILE, {}, false, now));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].businessName, 'Juniper Studio');
});
test('saved views include contacted and won leads while excluding dismissed leads', () => {
  const states = { [permits[0].id]: { status: 'saved', notes: '' }, [permits[1].id]: { status: 'contacted', notes: '' }, [permits[2].id]: { status: 'won', notes: '' }, [permits[3].id]: { status: 'dismissed', notes: '' } };
  const matches = permits.filter(p => matchesFilters(p, DEFAULT_FILTERS, DEFAULT_PROFILE, states, true, now));
  assert.deepEqual(matches.map(p => p.id), permits.slice(0, 3).map(p => p.id));
});
test('priority responds to service area and trade without changing permit status', () => {
  const profile = { ...DEFAULT_PROFILE, trades: ['HVAC'], counties: ['Orange'] };
  const matching = scorePermit(permits[2], profile, now);
  const other = scorePermit(permits[1], profile, now);
  assert.ok(matching.priority > other.priority);
  assert.equal(other.status, 'Unknown');
  assert.ok(matching.priorityReasons.includes('Matches your services'));
});
test('highest-value sorting puts missing values last', () => {
  const sorted = permits.toSorted((a, b) => comparePermits(a, b, 'value'));
  assert.equal(sorted[0].value, 680000);
  assert.equal(sorted.at(-1).value, null);
});
test('summary counts represent records and preserve unknown statuses', () => {
  const stats = summarize(permits, now);
  assert.equal(stats.total, 36);
  assert.equal(stats.today, 5);
  assert.equal(stats.commercial, 32);
  assert.ok(stats.open < stats.total);
});
test('CSV includes notes and contact roles while neutralizing formulas', () => {
  const p = { ...permits[0], businessName: '=HYPERLINK("https://example.com")', contactName: 'Applicant, one' };
  const csv = makeCsv([p], { [p.id]: { status: 'saved', notes: 'first line\nsecond "line"' } });
  assert.ok(csv.includes('"\'=HYPERLINK('));
  assert.ok(csv.includes('"Applicant, one"'));
  assert.ok(csv.includes('second ""line""'));
  assert.ok(!csv.includes('Demo record'));
  assert.ok(csv.includes('first line'));
});
test('password derivation interoperates with Node crypto and distinguishes wrong passwords', async () => {
  const password = 'test-only-password', salt = 'test-only-salt';
  const hash = await passwordHash(password, salt);
  assert.equal(hash, pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex'));
  assert.equal(constantTimeEqual(hash, await passwordHash('wrong-password', salt)), false);
});
test('session cookies are HttpOnly, secure on HTTPS and reject malformed values', () => {
  const token = 'a'.repeat(64), req = new Request('https://example.com/api/workspace', { headers: { Cookie: `permitline_session=${token}; other=1` } });
  assert.equal(sessionToken(req), token);
  assert.match(sessionCookie(token, req), /HttpOnly; SameSite=Strict/);
  assert.match(sessionCookie(token, req), /Secure/);
  assert.match(sessionCookie('', req, true), /Max-Age=0/);
  assert.equal(sessionToken(new Request('https://example.com', { headers: { Cookie: 'permitline_session=forged' } })), null);
});
