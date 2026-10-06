import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFailure } from '../server/failure.ts';
import { databaseClient } from '../scripts/database-client.mjs';

test('database authentication failures remain actionable through an ORM error wrapper', () => {
  const cause = Object.assign(new Error('private connection string'), { code: '28P01' });
  const failure = safeFailure(new Error('private SQL and parameter values', { cause }));
  assert.equal(failure.errorCode, '28P01');
  assert.match(failure.error, /current Supabase database password/);
  assert.ok(!JSON.stringify(failure).includes('private'));
});
test('aggregate network errors and circular causes do not leak arbitrary data', () => {
  const cause = Object.assign(new Error('private host'), { code: 'ENOTFOUND' });
  cause.cause = cause;
  const failure = safeFailure(new AggregateError([cause], 'private details'));
  assert.equal(failure.errorCode, 'ENOTFOUND');
  assert.ok(!JSON.stringify(failure).includes('private'));
  assert.equal(safeFailure({ code: 'secret-value', message: 'secret-value' }).errorCode, 'REQUEST_FAILED');
});
test('malformed connection strings never appear in configuration errors', () => {
  const previous = process.env.DATABASE_URL;
  try {
    for (const value of ['not-a-url-with-test-only-secret', 'https://test-only-secret@example.test']) {
      process.env.DATABASE_URL = value;
      assert.throws(databaseClient, error => error.code === 'DATABASE_URL_INVALID' && !error.message.includes('test-only-secret') && !('input' in error));
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
